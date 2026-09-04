import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir, homedir } from "node:os"
import {
  _resetAssignedNamesForTests,
  createSession,
  destroySession,
  listSessions,
  nudgeSession,
  shouldSuppressRecord,
  updateSession,
} from "../terminal-manager"
import {
  serializeReplay,
  flushReplay,
  _resetReplayForTests,
} from "../terminalReplay"
import { namesDir } from "../terminal-identity"
import { buildRunAsSpawnCommand } from "../terminal-run-as"

// Mutable, test-controlled stand-in for `listOsUsers()`'s real /etc/passwd
// read — `vi.hoisted` because `vi.mock` factories are hoisted above normal
// module-scope `let`/`const` declarations, so a factory that closes over a
// plain outer variable would read it before it's initialized.
const mockOsUsers = vi.hoisted(() => ({
  users: [{ username: "greg-ip", homeDir: "/home/greg-ip", shell: "/bin/bash" }],
}))

vi.mock("../os-users", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../os-users")>()
  return {
    ...actual,
    listOsUsers: () => mockOsUsers.users,
  }
})

// Fake node-pty: capture the onData callbacks registered against the
// most-recently-spawned pty so a test can drive PTY output deterministically
// without spawning a real shell.
let lastPtyDataCallbacks: Array<(data: string) => void> = []
// Recorder for the most recent spawn(file, args, options) call, so a test can
// assert on the env passed to node-pty without changing the fake's shape.
let lastSpawnCall: { file: string; args: string[]; options: Record<string, unknown> } | undefined
// The most-recently-spawned pty's onExit callback, so a test can simulate the
// shell exiting on its own (not via destroySession).
let lastPtyExitCallback: (() => void) | undefined
function emitPtyData(data: string): void {
  for (const cb of lastPtyDataCallbacks) cb(data)
}
// Every test in this file goes through createSession, and createSession
// always writes an identity file (writeName) regardless of which describe
// block is exercising it. Redirecting PANEL_AUTH_STATE_DIR must therefore be
// a file-level concern, not scoped to one describe block — otherwise any
// test outside that block resolves namesDir() to the real
// homedir()/.panel/terminals, and a failed assertion (which skips the
// trailing destroySession) leaks a file into the user's real home directory.
let previousStateDir: string | undefined
let tempDir: string

beforeEach(() => {
  previousStateDir = process.env.PANEL_AUTH_STATE_DIR
  tempDir = mkdtempSync(join(tmpdir(), "panel-terminal-manager-test-"))
  process.env.PANEL_AUTH_STATE_DIR = tempDir
})

afterEach(() => {
  if (previousStateDir === undefined) delete process.env.PANEL_AUTH_STATE_DIR
  else process.env.PANEL_AUTH_STATE_DIR = previousStateDir
  rmSync(tempDir, { recursive: true, force: true })
})

vi.mock("node-pty", () => ({
  spawn: (file: string, args: string[], options: Record<string, unknown>) => {
    lastSpawnCall = { file, args, options }
    const dataCallbacks: Array<(data: string) => void> = []
    lastPtyDataCallbacks = dataCallbacks
    return {
      pid: 1234,
      onData: (cb: (data: string) => void) => {
        dataCallbacks.push(cb)
        return { dispose: () => {} }
      },
      onExit: (cb: () => void) => {
        lastPtyExitCallback = cb
        return { dispose: () => {} }
      },
      resize: () => {},
      kill: () => {},
      write: () => {},
    }
  },
}))

describe("shouldSuppressRecord", () => {
  it("returns false when suppressUntil is undefined", () => {
    expect(shouldSuppressRecord(undefined, 1000)).toBe(false)
  })
  it("returns false when the window has expired", () => {
    expect(shouldSuppressRecord(999, 1000)).toBe(false)
  })
  it("returns false at the exact expiry boundary", () => {
    expect(shouldSuppressRecord(1000, 1000)).toBe(false)
  })
  it("returns true while the window is still open", () => {
    expect(shouldSuppressRecord(1700, 1000)).toBe(true)
  })
})

describe("nudgeSession", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-22T10:00:00Z"))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("sets a 700ms suppression window that gates recordOutput", () => {
    const meta = createSession({ cwd: process.cwd(), cols: 80, rows: 24, project: "test" })
    const now = Date.now()
    const ok = nudgeSession(meta.id, 80, 24)
    expect(ok).toBe(true)

    // Directly exercise the gate the onData handler relies on.
    expect(shouldSuppressRecord(now + 700, now)).toBe(true)       // still open
    expect(shouldSuppressRecord(now + 700, now + 699)).toBe(true) // still open
    expect(shouldSuppressRecord(now + 700, now + 700)).toBe(false) // at boundary: open window closed

    destroySession(meta.id)
  })

  it("returns false when the session does not exist", () => {
    expect(nudgeSession("nonexistent", 80, 24)).toBe(false)
  })
})

describe("replay buffer wiring", () => {
  afterEach(() => {
    _resetReplayForTests()
    // guard against emitPtyData replaying a stale pty across tests
    lastPtyDataCallbacks = []
  })

  it("feeds PTY output into the session's replay buffer", async () => {
    const meta = createSession({ cwd: process.cwd(), cols: 80, rows: 24, project: "test" })
    emitPtyData("REPLAY_ME")
    await flushReplay(meta.id)
    expect(serializeReplay(meta.id)).toContain("REPLAY_ME")
    destroySession(meta.id)
  })

  it("tears down the replay buffer on destroySession", async () => {
    const meta = createSession({ cwd: process.cwd(), cols: 80, rows: 24, project: "test" })
    emitPtyData("GONE_SOON")
    await flushReplay(meta.id)
    destroySession(meta.id)
    expect(serializeReplay(meta.id)).toBe("")
  })
})

describe("session model", () => {
  it("the session model carries no colour", () => {
    const meta = createSession({ cwd: process.cwd(), cols: 80, rows: 24, project: "alpha" })

    // Colour identifies a project now, and lives in the committed store. A PTY
    // dies with the server, so a colour kept on a session could never outlive
    // the thing it labelled.
    expect(Object.hasOwn(meta, "color")).toBe(false)
    const listed = listSessions().find((s) => s.id === meta.id)
    expect(listed).toBeDefined()
    expect(Object.hasOwn(listed!, "color")).toBe(false)

    destroySession(meta.id)
  })

  it("ignores a colour in an update instead of persisting it", () => {
    const meta = createSession({ cwd: process.cwd(), cols: 80, rows: 24, project: "alpha" })

    const ok = updateSession(meta.id, { name: "renamed", color: "#f0c674" } as {
      name?: string
    })

    expect(ok).toBe(true)
    const listed = listSessions().find((s) => s.id === meta.id)!
    expect(listed.name).toBe("renamed")
    expect(Object.hasOwn(listed, "color")).toBe(false)

    destroySession(meta.id)
  })
})

describe("spawn env", () => {
  it("spawn env carries PAVILIO_TERMINAL_ID matching the session id", () => {
    const meta = createSession({ cwd: process.cwd(), cols: 80, rows: 24, project: "alpha" })

    expect(lastSpawnCall).toBeDefined()
    const env = lastSpawnCall!.options.env as Record<string, string>
    expect(env.PAVILIO_TERMINAL_ID).toBe(meta.id)

    destroySession(meta.id)
  })

  it("spawn env still inherits process env and TERM", () => {
    const meta = createSession({ cwd: process.cwd(), cols: 80, rows: 24, project: "alpha" })

    const env = lastSpawnCall!.options.env as Record<string, string>
    expect(env.TERM).toBe("xterm-256color")
    expect(env.PATH).toBe(process.env.PATH)

    destroySession(meta.id)
  })
})

describe("default session names", () => {
  it("a new session defaults to project-scoped name alokai-1", () => {
    const meta = createSession({ cwd: process.cwd(), cols: 80, rows: 24, project: "alokai" })
    expect(meta.name).toBe("alokai-1")
    destroySession(meta.id)
  })

  it("default names are numbered per project", () => {
    const alokai = createSession({ cwd: process.cwd(), cols: 80, rows: 24, project: "alokai" })
    const motyl = createSession({ cwd: process.cwd(), cols: 80, rows: 24, project: "motyl" })
    expect(motyl.name).toBe("motyl-1")
    destroySession(alokai.id)
    destroySession(motyl.id)
  })

  it("an explicit name overrides the default allocator", () => {
    const meta = createSession({
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      project: "alokai",
      name: "deploy-watch",
    })
    expect(meta.name).toBe("deploy-watch")
    destroySession(meta.id)
  })

  it("an empty explicit name falls through to the project allocator", () => {
    // Reset so this test's expected alokai-1 doesn't depend on how many
    // alokai-project names earlier tests in this describe block already
    // assigned.
    _resetAssignedNamesForTests()
    const meta = createSession({
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      project: "alokai",
      name: "",
    })
    expect(meta.name).toBe("alokai-1")
    destroySession(meta.id)
  })

  it('an explicit name of "0" is kept verbatim', () => {
    // Reset so this test's expected alokai-1 for the follow-up default
    // session doesn't depend on earlier tests in this describe block.
    _resetAssignedNamesForTests()
    const zero = createSession({
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      project: "alokai",
      name: "0",
    })
    expect(zero.name).toBe("0")

    const next = createSession({ cwd: process.cwd(), cols: 80, rows: 24, project: "alokai" })
    expect(next.name).toBe("alokai-1")

    destroySession(zero.id)
    destroySession(next.id)
  })
})

describe("session name allocator persists across the process", () => {
  // Isolate each test from the assigned-name record left behind by every
  // other test in this file — the record is deliberately never pruned in
  // production, so tests must reset it themselves to get a clean project
  // namespace.
  beforeEach(() => {
    _resetAssignedNamesForTests()
  })

  it("the highest-numbered session's number is not reused after it is destroyed", () => {
    const first = createSession({ cwd: process.cwd(), cols: 80, rows: 24, project: "alokai" })
    const second = createSession({ cwd: process.cwd(), cols: 80, rows: 24, project: "alokai" })
    expect(first.name).toBe("alokai-1")
    expect(second.name).toBe("alokai-2")

    destroySession(second.id)

    const third = createSession({ cwd: process.cwd(), cols: 80, rows: 24, project: "alokai" })
    expect(third.name).toBe("alokai-3")

    destroySession(first.id)
    destroySession(third.id)
  })

  it("an explicitly named session's number is not handed out again", () => {
    const explicit = createSession({
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      project: "alokai",
      name: "alokai-5",
    })
    destroySession(explicit.id)

    const next = createSession({ cwd: process.cwd(), cols: 80, rows: 24, project: "alokai" })
    expect(next.name).toBe("alokai-6")

    destroySession(next.id)
  })

  it("renaming a session does not free its number", () => {
    const first = createSession({ cwd: process.cwd(), cols: 80, rows: 24, project: "alokai" })
    updateSession(first.id, { name: "deploy-watch" })

    const second = createSession({ cwd: process.cwd(), cols: 80, rows: 24, project: "alokai" })
    expect(second.name).toBe("alokai-2")

    destroySession(first.id)
    destroySession(second.id)
  })
})

describe("identity file lifecycle", () => {
  // File-level beforeEach/afterEach (above) already redirects
  // PANEL_AUTH_STATE_DIR to a fresh temp dir per test — no per-describe
  // redirect needed here.

  function readIdentityFile(id: string): string | undefined {
    const file = join(namesDir(), id)
    if (!existsSync(file)) return undefined
    return readFileSync(file, "utf8")
  }

  it("creating a session writes its identity file", () => {
    const meta = createSession({ cwd: process.cwd(), cols: 80, rows: 24, project: "alokai" })
    expect(readIdentityFile(meta.id)).toBe(`${meta.name}\n`)
    destroySession(meta.id)
  })

  it("renaming a session rewrites its identity file", () => {
    const meta = createSession({ cwd: process.cwd(), cols: 80, rows: 24, project: "alokai" })
    updateSession(meta.id, { name: "deploy-watch" })
    expect(readIdentityFile(meta.id)).toBe("deploy-watch\n")
    destroySession(meta.id)
  })

  it("renaming an unknown session writes no file", () => {
    const ok = updateSession("00000000-0000-4000-8000-000000000000", { name: "ghost" })
    expect(ok).toBe(false)
    expect(readIdentityFile("00000000-0000-4000-8000-000000000000")).toBeUndefined()
  })

  it("destroying a session removes its identity file", () => {
    const meta = createSession({ cwd: process.cwd(), cols: 80, rows: 24, project: "alokai" })
    expect(readIdentityFile(meta.id)).toBeDefined()
    destroySession(meta.id)
    expect(readIdentityFile(meta.id)).toBeUndefined()
  })

  it("a session whose shell exits removes its identity file", () => {
    const meta = createSession({ cwd: process.cwd(), cols: 80, rows: 24, project: "alokai" })
    expect(readIdentityFile(meta.id)).toBeDefined()
    // Simulate the PTY exiting on its own (not via destroySession).
    lastPtyExitCallback?.()
    expect(readIdentityFile(meta.id)).toBeUndefined()
  })
})

describe("createSession with runAsUser", () => {
  const RUN_AS_USER = "greg-ip"
  const DEFAULT_TARGET_USER = { username: RUN_AS_USER, homeDir: "/home/greg-ip", shell: "/bin/bash" }

  afterEach(() => {
    // Restore the default mocked user list so a test that swaps it in for a
    // temp-dir home doesn't leak into later tests in this file.
    mockOsUsers.users = [DEFAULT_TARGET_USER]
  })

  function withWslDistroName(value: string | undefined, run: () => void): void {
    const previous = process.env.WSL_DISTRO_NAME
    if (value === undefined) delete process.env.WSL_DISTRO_NAME
    else process.env.WSL_DISTRO_NAME = value
    try {
      run()
    } finally {
      if (previous === undefined) delete process.env.WSL_DISTRO_NAME
      else process.env.WSL_DISTRO_NAME = previous
    }
  }

  it("createSession without runAsUser spawns directly, unchanged from today", () => {
    const meta = createSession({ cwd: process.cwd(), cols: 80, rows: 24, project: "alokai" })

    expect(lastSpawnCall!.file).not.toBe("su")
    expect(lastSpawnCall!.file).not.toBe("wsl.exe")
    expect(lastSpawnCall!.args).toEqual([])
    expect(lastSpawnCall!.options.cwd).toBe(process.cwd())

    destroySession(meta.id)
  })

  it("createSession with a valid runAsUser on posix spawns the su form with a translated cwd", () => {
    withWslDistroName(undefined, () => {
      const cwd = `${homedir()}/git/prv/pavilio`
      const meta = createSession({
        cwd,
        cols: 80,
        rows: 24,
        project: "alokai",
        runAsUser: RUN_AS_USER,
      })

      const translatedCwd = "/home/greg-ip/git/prv/pavilio"
      const expected = buildRunAsSpawnCommand({
        user: DEFAULT_TARGET_USER,
        cwd: translatedCwd,
        sessionId: meta.id,
        wslDistro: undefined,
      })

      expect(lastSpawnCall!.file).toBe("su")
      expect(lastSpawnCall!.args).toEqual(expected.args)
      expect(lastSpawnCall!.options.cwd).toBe(translatedCwd)

      destroySession(meta.id)
    })
  })

  it("createSession with a valid runAsUser under WSL_DISTRO_NAME spawns the wsl.exe form", () => {
    withWslDistroName("Ubuntu", () => {
      const cwd = `${homedir()}/git/prv/pavilio`
      const meta = createSession({
        cwd,
        cols: 80,
        rows: 24,
        project: "alokai",
        runAsUser: RUN_AS_USER,
      })

      const translatedCwd = "/home/greg-ip/git/prv/pavilio"
      const expected = buildRunAsSpawnCommand({
        user: DEFAULT_TARGET_USER,
        cwd: translatedCwd,
        sessionId: meta.id,
        wslDistro: "Ubuntu",
      })

      expect(lastSpawnCall!.file).toBe("wsl.exe")
      expect(lastSpawnCall!.args).toEqual(expected.args)
      expect(lastSpawnCall!.options.cwd).toBe(translatedCwd)

      destroySession(meta.id)
    })
  })

  it("createSession with an unknown runAsUser falls back to direct spawn", () => {
    const meta = createSession({
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      project: "alokai",
      runAsUser: "no-such-user",
    })

    expect(lastSpawnCall!.file).not.toBe("su")
    expect(lastSpawnCall!.file).not.toBe("wsl.exe")
    expect(lastSpawnCall!.args).toEqual([])
    expect(lastSpawnCall!.options.cwd).toBe(process.cwd())

    destroySession(meta.id)
  })

  it("identity file for a runAsUser session is written under that user's home, not the server's own", () => {
    const previousStateDirInTest = process.env.PANEL_AUTH_STATE_DIR
    delete process.env.PANEL_AUTH_STATE_DIR
    const otherHome = mkdtempSync(join(tmpdir(), "panel-terminal-manager-runas-home-"))
    mockOsUsers.users = [{ username: RUN_AS_USER, homeDir: otherHome, shell: "/bin/bash" }]
    try {
      const meta = createSession({
        cwd: process.cwd(),
        cols: 80,
        rows: 24,
        project: "alokai",
        runAsUser: RUN_AS_USER,
      })

      const identityFile = join(otherHome, ".panel", "terminals", meta.id)
      expect(existsSync(identityFile)).toBe(true)
      expect(readFileSync(identityFile, "utf8")).toBe(`${meta.name}\n`)
      // Not written under the server's own (real) home either.
      expect(existsSync(join(namesDir(), meta.id))).toBe(false)

      destroySession(meta.id)
    } finally {
      rmSync(otherHome, { recursive: true, force: true })
      if (previousStateDirInTest !== undefined) {
        process.env.PANEL_AUTH_STATE_DIR = previousStateDirInTest
      }
    }
  })

  it("identity file for a runAsUser session is removed from that user's home on destroySession", () => {
    const previousStateDirInTest = process.env.PANEL_AUTH_STATE_DIR
    delete process.env.PANEL_AUTH_STATE_DIR
    const otherHome = mkdtempSync(join(tmpdir(), "panel-terminal-manager-runas-home-"))
    mockOsUsers.users = [{ username: RUN_AS_USER, homeDir: otherHome, shell: "/bin/bash" }]
    try {
      const meta = createSession({
        cwd: process.cwd(),
        cols: 80,
        rows: 24,
        project: "alokai",
        runAsUser: RUN_AS_USER,
      })

      const identityFile = join(otherHome, ".panel", "terminals", meta.id)
      expect(existsSync(identityFile)).toBe(true)

      destroySession(meta.id)
      expect(existsSync(identityFile)).toBe(false)
    } finally {
      rmSync(otherHome, { recursive: true, force: true })
      if (previousStateDirInTest !== undefined) {
        process.env.PANEL_AUTH_STATE_DIR = previousStateDirInTest
      }
    }
  })
})
