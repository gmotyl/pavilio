import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  __setCloseDeps,
  closeAllSessions,
  closeSession,
  createSession,
  getSession,
  listSessions,
  SHUTDOWN_SCHEDULE,
  CLOSE_SCHEDULE,
} from "../terminal-manager"

// Fake node-pty: every spawn gets the next pid and records its onExit handler
// so a test can play the PTY dying at a chosen moment.
const fake = vi.hoisted(() => ({
  nextPid: 100,
  exits: new Map<number, () => void>(),
}))

vi.mock("node-pty", () => ({
  spawn: () => {
    const pid = fake.nextPid++
    return {
      pid,
      onData: () => ({ dispose: () => {} }),
      onExit: (cb: () => void) => {
        fake.exits.set(pid, cb)
        return { dispose: () => {} }
      },
      resize: () => {},
      kill: () => {},
      write: () => {},
    }
  },
}))

type Sent = Array<[number, string]>
let sent: Sent
let table: Map<number, number[]>
let previousStateDir: string | undefined
let tempDir: string

function open(): { id: string; pid: number } {
  const meta = createSession({ cwd: process.cwd(), cols: 80, rows: 24, project: "t" })
  return { id: meta.id, pid: meta.pid }
}
const signals = (name: string) => sent.filter(([, s]) => s === name).map(([p]) => p).sort()

beforeEach(() => {
  vi.useFakeTimers()
  previousStateDir = process.env.PANEL_AUTH_STATE_DIR
  tempDir = mkdtempSync(join(tmpdir(), "panel-terminal-close-test-"))
  process.env.PANEL_AUTH_STATE_DIR = tempDir
  sent = []
  table = new Map()
  __setCloseDeps({
    kill: (pid, signal) => void sent.push([pid, signal]),
    readTable: () => table,
  })
})

afterEach(() => {
  for (const exit of fake.exits.values()) exit()
  fake.exits.clear()
  __setCloseDeps()
  vi.useRealTimers()
  if (previousStateDir === undefined) delete process.env.PANEL_AUTH_STATE_DIR
  else process.env.PANEL_AUTH_STATE_DIR = previousStateDir
  rmSync(tempDir, { recursive: true, force: true })
})

describe("closeSession", () => {
  it("close sends SIGHUP to the whole session tree", async () => {
    const { id, pid } = open()
    table = new Map([[pid, [pid + 1000]], [pid + 1000, [pid + 2000]], [7, [8]]])
    const p = closeSession(id)
    expect(signals("SIGHUP")).toEqual([pid, pid + 1000, pid + 2000].sort())
    fake.exits.get(pid)!()
    await p
  })

  it("exit on hangup sends no further signal", async () => {
    const { id, pid } = open()
    const p = closeSession(id)
    fake.exits.get(pid)!()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await p).toBe("exited")
    expect(sent.every(([, s]) => s === "SIGHUP")).toBe(true)
  })

  it("a surviving tree escalates to SIGTERM then SIGKILL", async () => {
    const { id, pid } = open()
    const p = closeSession(id)
    await vi.advanceTimersByTimeAsync(CLOSE_SCHEDULE.hupToTermMs! - 1)
    expect(signals("SIGTERM")).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(signals("SIGTERM")).toEqual([pid])
    expect(signals("SIGKILL")).toEqual([])
    await vi.advanceTimersByTimeAsync(CLOSE_SCHEDULE.termToKillMs)
    expect(signals("SIGKILL")).toEqual([pid])
    fake.exits.get(pid)!()
    expect(await p).toBe("exited")
  })

  it("a reparented child is still signalled after its parent dies", async () => {
    const { id, pid } = open()
    table = new Map([[pid, [900]]])
    const p = closeSession(id)
    // The child was reparented to init: no longer reachable from the PTY pid.
    table = new Map([[1, [900]]])
    await vi.advanceTimersByTimeAsync(CLOSE_SCHEDULE.hupToTermMs!)
    expect(signals("SIGTERM")).toContain(900)
    await vi.advanceTimersByTimeAsync(CLOSE_SCHEDULE.termToKillMs)
    expect(signals("SIGKILL")).toContain(900)
    fake.exits.get(pid)!()
    await p
  })

  it("still alive after kill keeps the session listed", async () => {
    const { id } = open()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const p = closeSession(id)
    await vi.advanceTimersByTimeAsync(
      CLOSE_SCHEDULE.hupToTermMs! + CLOSE_SCHEDULE.termToKillMs + CLOSE_SCHEDULE.afterKillMs,
    )
    expect(await p).toBe("still-alive")
    expect(warn).toHaveBeenCalled()
    expect(listSessions().map((s) => s.id)).toContain(id)
    warn.mockRestore()
  })

  it("the session is removed only by the pty exit", async () => {
    const { id, pid } = open()
    const p = closeSession(id)
    await vi.advanceTimersByTimeAsync(1500)
    expect(getSession(id)).toBeDefined()
    fake.exits.get(pid)!()
    expect(getSession(id)).toBeUndefined()
    expect(await p).toBe("exited")
  })

  it("a repeat close shares the pending outcome", async () => {
    const { id, pid } = open()
    const a = closeSession(id)
    const b = closeSession(id)
    expect(b).toBe(a)
    expect(signals("SIGHUP")).toEqual([pid])
    fake.exits.get(pid)!()
    await a
  })

  it("closing an unknown session reports not-found", async () => {
    expect(await closeSession("nope")).toBe("not-found")
  })

  it("the shutdown schedule skips SIGTERM", async () => {
    const { id, pid } = open()
    const p = closeSession(id, SHUTDOWN_SCHEDULE)
    await vi.advanceTimersByTimeAsync(SHUTDOWN_SCHEDULE.termToKillMs)
    expect(signals("SIGTERM")).toEqual([])
    expect(signals("SIGKILL")).toEqual([pid])
    fake.exits.get(pid)!()
    await p
  })

  it("closeAllSessions closes every live session", async () => {
    const a = open()
    const b = open()
    const p = closeAllSessions(SHUTDOWN_SCHEDULE)
    expect(signals("SIGHUP")).toEqual([a.pid, b.pid].sort())
    fake.exits.get(a.pid)!()
    fake.exits.get(b.pid)!()
    await p
    expect(listSessions()).toEqual([])
  })
})
