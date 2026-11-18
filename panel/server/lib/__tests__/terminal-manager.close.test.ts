import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  __setCloseDeps,
  closeAllSessions,
  __resetShuttingDownForTests,
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
let alive: Set<number>
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
  alive = new Set()
  __setCloseDeps({
    kill: (pid, signal) => void sent.push([pid, signal]),
    readTable: () => table,
    isAlive: (pid) => alive.has(pid),
  })
})

afterEach(() => {
  for (const exit of fake.exits.values()) exit()
  fake.exits.clear()
  __setCloseDeps()
  __resetShuttingDownForTests()
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

  it("a snapshot child that ignores hangup after the pty exits gets TERM then KILL", async () => {
    const { id, pid } = open()
    table = new Map([[pid, [900]]])
    alive.add(900)
    const p = closeSession(id)
    fake.exits.get(pid)!()
    await vi.advanceTimersByTimeAsync(CLOSE_SCHEDULE.hupToTermMs!)
    expect(signals("SIGTERM")).toEqual([900])
    await vi.advanceTimersByTimeAsync(CLOSE_SCHEDULE.termToKillMs)
    expect(signals("SIGKILL")).toEqual([900])
    alive.delete(900)
    await vi.advanceTimersByTimeAsync(100)
    expect(await p).toBe("exited")
  })

  it("a phase that sees the pty exit early still ends on schedule", async () => {
    const { id, pid } = open()
    table = new Map([[pid, [900]]])
    alive.add(900)
    const schedule = { hupToTermMs: 500, termToKillMs: 500, afterKillMs: 0 }
    const p = closeSession(id, schedule)
    await vi.advanceTimersByTimeAsync(100)
    fake.exits.get(pid)!()
    await vi.advanceTimersByTimeAsync(399)
    expect(signals("SIGTERM")).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(signals("SIGTERM")).toEqual([900])
    await vi.advanceTimersByTimeAsync(499)
    expect(signals("SIGKILL")).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(signals("SIGKILL")).toEqual([900])
    alive.delete(900)
    await p
  })

  it("survivors after SIGKILL report still-alive with a warning", async () => {
    const { id, pid } = open()
    table = new Map([[pid, [900]]])
    alive.add(900)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const p = closeSession(id)
    fake.exits.get(pid)!()
    await vi.advanceTimersByTimeAsync(
      CLOSE_SCHEDULE.hupToTermMs! + CLOSE_SCHEDULE.termToKillMs + CLOSE_SCHEDULE.afterKillMs,
    )
    expect(await p).toBe("still-alive")
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("pty exit with every snapshot pid dead sends no TERM or KILL", async () => {
    const { id, pid } = open()
    table = new Map([[pid, [900]]])
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
    expect(signals("SIGHUP")).toEqual([pid, 900].sort())
    await vi.advanceTimersByTimeAsync(CLOSE_SCHEDULE.hupToTermMs!)
    expect(signals("SIGTERM")).toContain(900)
    await vi.advanceTimersByTimeAsync(CLOSE_SCHEDULE.termToKillMs)
    expect(signals("SIGKILL")).toContain(900)
    fake.exits.get(pid)!()
    await p
  })

  it("a child spawned after SIGHUP receives SIGTERM", async () => {
    const { id, pid } = open()
    const p = closeSession(id)
    // Appears only after the HUP window: the TERM snapshot must see it.
    table = new Map([[pid, [901]]])
    await vi.advanceTimersByTimeAsync(CLOSE_SCHEDULE.hupToTermMs!)
    expect(signals("SIGHUP")).toEqual([pid])
    expect(signals("SIGTERM")).toEqual([pid, 901].sort())
    fake.exits.get(pid)!()
    await p
  })

  it("a child spawned after SIGTERM receives SIGKILL", async () => {
    const { id, pid } = open()
    const p = closeSession(id)
    await vi.advanceTimersByTimeAsync(CLOSE_SCHEDULE.hupToTermMs!)
    // Appears only after the TERM window: the KILL snapshot must see it.
    table = new Map([[pid, [902]]])
    await vi.advanceTimersByTimeAsync(CLOSE_SCHEDULE.termToKillMs)
    expect(signals("SIGTERM")).toEqual([pid])
    expect(signals("SIGKILL")).toEqual([pid, 902].sort())
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

  it("a shorter schedule escalates a pending close and keeps one promise", async () => {
    const { id, pid } = open()
    const a = closeSession(id)
    await vi.advanceTimersByTimeAsync(100)
    const b = closeSession(id, SHUTDOWN_SCHEDULE)
    expect(b).toBe(a)
    expect(signals("SIGHUP")).toEqual([pid])
    // 500 ms phase measured from the HUP at t=0, TERM skipped.
    await vi.advanceTimersByTimeAsync(399)
    expect(signals("SIGKILL")).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(signals("SIGKILL")).toEqual([pid])
    expect(signals("SIGTERM")).toEqual([])
    fake.exits.get(pid)!()
    await a
  })

  it("a longer schedule never relaxes a pending close", async () => {
    const { id, pid } = open()
    const a = closeSession(id, SHUTDOWN_SCHEDULE)
    expect(closeSession(id, CLOSE_SCHEDULE)).toBe(a)
    await vi.advanceTimersByTimeAsync(500)
    expect(signals("SIGKILL")).toEqual([pid])
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

  it("createSession refuses once closeAllSessions has started", async () => {
    const a = open()
    const p = closeAllSessions(SHUTDOWN_SCHEDULE)
    expect(() => open()).toThrowError(/shutting down/)
    expect(listSessions().map((s) => s.id)).toEqual([a.id])
    fake.exits.get(a.pid)!()
    await p
  })

  it("closeAllSessions sweeps a session that appeared during the close", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const a = open()
    let done = false
    const p = closeAllSessions(SHUTDOWN_SCHEDULE).then(() => void (done = true))
    fake.exits.get(a.pid)!()
    // Slipped in without going through createSession's guard (e.g. a spawn
    // already in flight). It is never exited by hand: only the sweep may end it.
    __resetShuttingDownForTests()
    const b = open()
    await vi.advanceTimersByTimeAsync(0)
    expect(signals("SIGHUP")).toContain(b.pid)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(SHUTDOWN_SCHEDULE.termToKillMs)
    expect(signals("SIGKILL")).toContain(b.pid)
    await p
    expect(done).toBe(true)
    warn.mockRestore()
  })

  it("closeAllSessions resolves though a session never exits, closing it once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const stuck = open()
    const p = closeAllSessions(SHUTDOWN_SCHEDULE)
    await vi.advanceTimersByTimeAsync(SHUTDOWN_SCHEDULE.termToKillMs + 5000)
    await p
    expect(listSessions().map((s) => s.id)).toEqual([stuck.id])
    expect(signals("SIGHUP")).toEqual([stuck.pid])
    expect(signals("SIGKILL")).toEqual([stuck.pid])
    warn.mockRestore()
  })

  it("closeAllSessions tightens a close whose session already left the map", async () => {
    const { id, pid } = open()
    table = new Map([[pid, [900]]])
    alive.add(900)
    const p = closeSession(id)
    await vi.advanceTimersByTimeAsync(100)
    fake.exits.get(pid)!()
    expect(getSession(id)).toBeUndefined()
    let done = false
    const all = closeAllSessions(SHUTDOWN_SCHEDULE).then(() => void (done = true))
    await vi.advanceTimersByTimeAsync(399)
    expect(signals("SIGKILL")).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(signals("SIGKILL")).toEqual([900])
    // SHUTDOWN allows no wait after KILL, so both promises settle at once.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await all
    expect(done).toBe(true)
    expect(await p).toBe("still-alive")
    warn.mockRestore()
  })
})
