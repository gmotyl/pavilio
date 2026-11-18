import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { closeSession, createSession, getSession, listSessions } from "../terminal-manager"

// Real pty, real processes: no fakes. Drives the close escalation end to end
// against a tree that ignores HUP and TERM, one member of which has also left
// the session (`setsid`) so only the process-table snapshot can find it.
const SHORT_SCHEDULE = { hupToTermMs: 200, termToKillMs: 200, afterKillMs: 500 }

function findSleeps(): number[] {
  try {
    return execFileSync("pgrep", ["-f", "^sleep 99[89]$"], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .map(Number)
  } catch {
    return [] // pgrep exits 1 when nothing matches
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH"
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe.skipIf(process.platform === "win32")("closeSession (real pty)", () => {
  let previousStateDir: string | undefined
  let previousShell: string | undefined
  let tempDir: string
  let pids: number[] = []

  beforeEach(() => {
    previousStateDir = process.env.PANEL_AUTH_STATE_DIR
    previousShell = process.env.SHELL
    tempDir = mkdtempSync(join(tmpdir(), "panel-terminal-close-it-"))
    process.env.PANEL_AUTH_STATE_DIR = tempDir
    // A plain sh: no rc files, deterministic regardless of the host's login shell.
    process.env.SHELL = "/bin/sh"
    pids = []
  })

  afterEach(() => {
    // Never leak the 998/999 sleeps, whatever the test outcome.
    for (const pid of [...pids, ...findSleeps()]) {
      try {
        process.kill(pid, "SIGKILL")
      } catch {
        /* already gone */
      }
    }
    if (previousStateDir === undefined) delete process.env.PANEL_AUTH_STATE_DIR
    else process.env.PANEL_AUTH_STATE_DIR = previousStateDir
    if (previousShell === undefined) delete process.env.SHELL
    else process.env.SHELL = previousShell
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("closing a session ends processes that ignore hangup and terminate", async () => {
    const meta = createSession({ cwd: process.cwd(), cols: 80, rows: 24, project: "t" })
    getSession(meta.id)!.pty.write(
      `sh -c "trap '' HUP TERM; setsid sleep 999 & sleep 998 & wait"\r`,
    )

    // Wait until both sleeps are running before closing.
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && (pids = findSleeps()).length < 2) await sleep(50)
    expect(pids).toHaveLength(2)

    expect(await closeSession(meta.id, SHORT_SCHEDULE)).toBe("exited")

    for (const pid of pids) expect(alive(pid), `pid ${pid} still alive`).toBe(false)
    expect(listSessions().map((s) => s.id)).not.toContain(meta.id)
  }, 20_000)
})
