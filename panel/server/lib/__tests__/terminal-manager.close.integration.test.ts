import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { descendants, readProcessTable } from "../session-tree"
import { closeSession, createSession, getSession, listSessions } from "../terminal-manager"

// Real pty, real processes: no fakes. Drives the close escalation end to end
// against a tree that ignores HUP and TERM, one member of which has also left
// the session (`setsid`) so only the process-table snapshot can find it.
const SHORT_SCHEDULE = { hupToTermMs: 200, termToKillMs: 200, afterKillMs: 500 }

// Sleeps are discovered only inside the PTY's process tree, so a concurrent
// run of this suite elsewhere on the machine can neither be seen nor killed.
function findSleeps(rootPid: number): number[] {
  const tree = [...descendants(rootPid, readProcessTable())].filter((p) => p !== rootPid)
  if (tree.length === 0) return []
  try {
    return execFileSync("ps", ["-o", "pid=,args=", "-p", tree.join(",")], { encoding: "utf8" })
      .split("\n")
      .map((line) => /^\s*(\d+)\s+sleep 99[89]$/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => Number(m[1]))
  } catch {
    return [] // ps exits 1 when none of the pids exist
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
  let rootPid: number | undefined
  let sessionId: string | undefined

  beforeEach(() => {
    previousStateDir = process.env.PANEL_AUTH_STATE_DIR
    previousShell = process.env.SHELL
    tempDir = mkdtempSync(join(tmpdir(), "panel-terminal-close-it-"))
    process.env.PANEL_AUTH_STATE_DIR = tempDir
    // A plain sh: no rc files, deterministic regardless of the host's login shell.
    process.env.SHELL = "/bin/sh"
    pids = []
    rootPid = undefined
    sessionId = undefined
  })

  afterEach(() => {
    // Never leak the 998/999 sleeps, whatever the test outcome.
    for (const pid of [...pids, ...(rootPid === undefined ? [] : findSleeps(rootPid))]) {
      try {
        process.kill(pid, "SIGKILL")
      } catch {
        /* already gone */
      }
    }
    // A failure before closeSession succeeds must not leak the PTY root: kill
    // it (its onExit removes the session) and drop the session if still listed.
    const live = sessionId === undefined ? undefined : getSession(sessionId)
    if (live) {
      try {
        live.pty.kill("SIGKILL")
      } catch {
        /* already gone */
      }
    }
    if (rootPid !== undefined) {
      try {
        process.kill(rootPid, "SIGKILL")
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
    sessionId = meta.id
    rootPid = getSession(meta.id)!.pty.pid
    getSession(meta.id)!.pty.write(
      `sh -c "trap '' HUP TERM; setsid sleep 999 & sleep 998 & wait"\r`,
    )

    // Wait until both sleeps are running before closing.
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && (pids = findSleeps(rootPid)).length < 2) await sleep(50)
    expect(pids).toHaveLength(2)

    expect(await closeSession(meta.id, SHORT_SCHEDULE)).toBe("exited")

    for (const pid of pids) expect(alive(pid), `pid ${pid} still alive`).toBe(false)
    expect(listSessions().map((s) => s.id)).not.toContain(meta.id)
  }, 20_000)
})
