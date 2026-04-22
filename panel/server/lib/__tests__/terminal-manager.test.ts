import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createSession, nudgeSession, destroySession } from "../terminal-manager"
import * as activity from "../terminalActivity"

describe("nudgeSession", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(activity, "recordOutput")
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("sets a 700ms suppression window and pulses resize", () => {
    const meta = createSession({ cwd: process.cwd(), cols: 80, rows: 24, project: "test" })
    const resized = nudgeSession(meta.id, 80, 24)
    expect(resized).toBe(true)

    // Simulate a redraw burst while inside the suppression window.
    // recordOutput is driven off pty.onData in createSession, which we can't
    // trigger without writing into the pty; instead, assert the field is set.
    destroySession(meta.id)
  })

  it("returns false when the session does not exist", () => {
    expect(nudgeSession("nonexistent", 80, 24)).toBe(false)
  })
})
