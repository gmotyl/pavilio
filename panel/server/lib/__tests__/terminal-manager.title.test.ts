import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  _resetAssignedNamesForTests,
  createSession,
  destroySession,
  getModePreamble,
  getSession,
  listSessions,
} from "../terminal-manager"
import {
  serializeReplay,
  flushReplay,
  _resetReplayForTests,
} from "../terminalReplay"
import { namesDir } from "../terminal-identity"
import type { TitleState } from "../terminal-title"

// The scanner is the real one for every test but the isolation one, which
// flips this flag to make it throw on the next chunk. `vi.hoisted` because a
// `vi.mock` factory is hoisted above plain module-scope declarations.
const scannerControl = vi.hoisted(() => ({ throws: false }))

vi.mock("../terminal-title", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../terminal-title")>()
  return {
    ...actual,
    scanTitle: (chunk: string, state: TitleState) => {
      if (scannerControl.throws) throw new Error("scanner exploded")
      return actual.scanTitle(chunk, state)
    },
  }
})

// Counts `writeName` calls without losing the real write — the identity file
// itself is asserted below, so the wrapper has to delegate.
const identityControl = vi.hoisted(() => ({ writeNameCalls: 0 }))

vi.mock("../terminal-identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../terminal-identity")>()
  return {
    ...actual,
    writeName: (id: string, name: string, homeDir?: string) => {
      identityControl.writeNameCalls++
      return actual.writeName(id, name, homeDir)
    },
  }
})

// Fake node-pty: capture the onData callbacks of the most-recently-spawned
// pty so a test can drive PTY output without spawning a real shell.
let lastPtyDataCallbacks: Array<(data: string) => void> = []
function emitPtyData(data: string): void {
  for (const cb of lastPtyDataCallbacks) cb(data)
}

vi.mock("node-pty", () => ({
  spawn: () => {
    const dataCallbacks: Array<(data: string) => void> = []
    lastPtyDataCallbacks = dataCallbacks
    return {
      pid: 4321,
      onData: (cb: (data: string) => void) => {
        dataCallbacks.push(cb)
        return { dispose: () => {} }
      },
      onExit: () => ({ dispose: () => {} }),
      resize: () => {},
      kill: () => {},
      write: () => {},
    }
  },
}))

// createSession always writes an identity file, so the state dir is
// redirected for every test in this file — a failed assertion would
// otherwise leak a file into the real home directory.
let previousStateDir: string | undefined
let tempDir: string

beforeEach(() => {
  previousStateDir = process.env.PANEL_AUTH_STATE_DIR
  tempDir = mkdtempSync(join(tmpdir(), "panel-terminal-title-test-"))
  process.env.PANEL_AUTH_STATE_DIR = tempDir
  scannerControl.throws = false
  identityControl.writeNameCalls = 0
  _resetAssignedNamesForTests()
})

afterEach(() => {
  scannerControl.throws = false
  lastPtyDataCallbacks = []
  _resetReplayForTests()
  for (const meta of listSessions()) destroySession(meta.id)
  if (previousStateDir === undefined) delete process.env.PANEL_AUTH_STATE_DIR
  else process.env.PANEL_AUTH_STATE_DIR = previousStateDir
  rmSync(tempDir, { recursive: true, force: true })
})

function open(project = "pavilio") {
  return createSession({ cwd: process.cwd(), cols: 80, rows: 24, project })
}

function listed(id: string) {
  return listSessions().find((s) => s.id === id)
}

describe("a session's title", () => {
  it("a title emitted by the PTY reaches the session list", () => {
    const meta = open()

    emitPtyData("\x1b]0;◐ Pavilio crash after changes\x07")

    expect(listed(meta.id)?.title).toBe("Pavilio crash after changes")
  })

  it("a chunk with no title leaves the stored title alone", () => {
    const meta = open()
    emitPtyData("\x1b]0;Pavilio crash after changes\x07")

    emitPtyData("$ ls -la\r\ntotal 0\r\n")

    expect(listed(meta.id)?.title).toBe("Pavilio crash after changes")
  })

  it("an emptied title clears the session's title", () => {
    const meta = open()
    emitPtyData("\x1b]0;Pavilio crash after changes\x07")

    emitPtyData("\x1b]0;\x07")

    const listedMeta = listed(meta.id)
    expect(listedMeta).toBeDefined()
    // Absent, not empty: the client helper reads it with `??`, so an empty
    // string would render as an empty label instead of falling back.
    expect(Object.hasOwn(listedMeta!, "title")).toBe(false)
    expect(JSON.parse(JSON.stringify(listedMeta))).not.toHaveProperty("title")
  })

  it("an unchanged title is not reassigned", () => {
    const meta = open()
    emitPtyData("\x1b]0;◐ Pavilio crash after changes\x07")

    const session = getSession(meta.id)!
    let stored: string | undefined = session.title
    let writes = 0
    Object.defineProperty(session, "title", {
      configurable: true,
      enumerable: true,
      get: () => stored,
      set: (value: string | undefined) => {
        writes++
        stored = value
      },
    })

    // The animating prefix flips every 960 ms; the normalised prose does not.
    emitPtyData("\x1b]0;◑ Pavilio crash after changes\x07")
    emitPtyData("\x1b]0;✳ Pavilio crash after changes\x07")
    expect(writes).toBe(0)

    // A genuinely different title still lands.
    emitPtyData("\x1b]0;◐ Reviewing the diff\x07")
    expect(writes).toBe(1)
    expect(listed(meta.id)?.title).toBe("Reviewing the diff")
  })

  it("a throwing scanner does not break replay or mode tracking", async () => {
    const meta = open()

    scannerControl.throws = true
    expect(() => emitPtyData("\x1b[?1049hSTILL_PIPED")).not.toThrow()

    await flushReplay(meta.id)
    expect(serializeReplay(meta.id)).toContain("STILL_PIPED")
    expect(getModePreamble(meta.id)).toContain("\x1b[?1049h")

    // And the path keeps working once the scanner recovers.
    scannerControl.throws = false
    emitPtyData("\x1b]0;Back to normal\x07")
    expect(listed(meta.id)?.title).toBe("Back to normal")
  })

  it("taking a title does not rewrite the identity file", () => {
    const meta = open()
    const callsAfterCreate = identityControl.writeNameCalls

    emitPtyData("\x1b]0;Pavilio crash after changes\x07")

    expect(identityControl.writeNameCalls).toBe(callsAfterCreate)
    const identityFile = join(namesDir(), meta.id)
    expect(existsSync(identityFile)).toBe(true)
    expect(readFileSync(identityFile, "utf8")).toBe(`${meta.name}\n`)
  })

  it("the default-name counter ignores titles", () => {
    const first = open("pavilio")
    expect(first.name).toBe("pavilio-1")

    emitPtyData("\x1b]0;Pavilio crash after changes\x07")

    const second = open("pavilio")
    expect(second.name).toBe("pavilio-2")
  })

  it("a title does not become the session's name", () => {
    const meta = open("pavilio")
    expect(meta.name).toBe("pavilio-1")

    emitPtyData("\x1b]0;Pavilio crash after changes\x07")

    // The title landed...
    expect(listed(meta.id)?.title).toBe("Pavilio crash after changes")
    // ...beside the name, not over it. Every consumer that treats the name as
    // an identifier — rename, the identity file, the label precedence rules —
    // reads this field, so the title must never be written into it.
    expect(listed(meta.id)?.name).toBe("pavilio-1")
    expect(getSession(meta.id)!.name).toBe("pavilio-1")
  })

  it("the scanner's carry buffer never reaches a client", () => {
    const meta = open()
    // An unterminated introducer parks bytes in the carry buffer.
    emitPtyData("\x1b]0;half a ti")

    expect(Object.hasOwn(meta, "titleState")).toBe(false)
    const listedMeta = listed(meta.id)!
    expect(Object.hasOwn(listedMeta, "titleState")).toBe(false)
    expect(JSON.stringify(listedMeta)).not.toContain("titleState")
    // The buffer is real, it just lives server-side.
    expect(getSession(meta.id)!.titleState.pending).toContain("\x1b]0;")
  })

  it("a title survives a flood of untitled output", () => {
    const meta = open()
    emitPtyData("\x1b]0;Pavilio crash after changes\x07")

    // The titled process keeps running and floods the stream: an OSC that is
    // not a title, then a runaway introducer that never terminates, then
    // ~80 KB of build log across 200 chunks carrying non-title escapes.
    emitPtyData("\x1b]10;?\x07")
    emitPtyData("\x1b]0;runaway with no terminator ")
    for (let i = 0; i < 200; i++) {
      emitPtyData(
        `\x1b[32m ok \x1b[0m compiled module ${i} ${"x".repeat(380)}\r\n`,
      )
    }

    // The title set before the flood is still the session's title...
    expect(listed(meta.id)?.title).toBe("Pavilio crash after changes")
    // ...and none of the flood was carried forward: the runaway sequence is
    // dropped rather than growing the carry buffer into an unbounded sink.
    expect(getSession(meta.id)!.titleState.pending).not.toContain(
      "compiled module",
    )
  })
})
