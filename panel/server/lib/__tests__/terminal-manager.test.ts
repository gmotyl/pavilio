import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createSession,
  destroySession,
  nudgeSession,
  shouldSuppressRecord,
} from "../terminal-manager"

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
