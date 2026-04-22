import { describe, it, expect } from "vitest";
import {
  createModeState,
  scanModeState,
  modePreamble,
} from "../terminal-mode-state";

describe("terminal-mode-state", () => {
  it("initial state emits empty preamble", () => {
    expect(modePreamble(createModeState())).toBe("");
  });

  it("tracks a single mode set", () => {
    const s = createModeState();
    scanModeState("\x1b[?1000h", s);
    expect(s.modes[1000]).toBe("h");
    expect(modePreamble(s)).toBe("\x1b[?1000h");
  });

  it("later reset overrides earlier set", () => {
    const s = createModeState();
    scanModeState("\x1b[?1000h", s);
    scanModeState("\x1b[?1000l", s);
    expect(s.modes[1000]).toBe("l");
    expect(modePreamble(s)).toBe("\x1b[?1000l");
  });

  it("parses multi-param sequences (CSI ? 1000;1006 h)", () => {
    const s = createModeState();
    scanModeState("\x1b[?1000;1006h", s);
    expect(s.modes[1000]).toBe("h");
    expect(s.modes[1006]).toBe("h");
  });

  it("ignores untracked DEC private modes", () => {
    const s = createModeState();
    scanModeState("\x1b[?7h", s); // auto-wrap — not tracked
    expect(s.modes[7]).toBeUndefined();
    expect(modePreamble(s)).toBe("");
  });

  it("handles a partial sequence split across chunks", () => {
    const s = createModeState();
    scanModeState("\x1b[?10", s);
    expect(s.modes[1000]).toBeUndefined();
    scanModeState("00h", s);
    expect(s.modes[1000]).toBe("h");
  });

  it("handles a partial sequence split mid-ESC", () => {
    const s = createModeState();
    scanModeState("some output\x1b", s);
    scanModeState("[?2004h", s);
    expect(s.modes[2004]).toBe("h");
  });

  it("scans around normal output without mixing it in", () => {
    const s = createModeState();
    scanModeState("hello \x1b[?1049h world \x1b[?1000h !", s);
    expect(s.modes[1049]).toBe("h");
    expect(s.modes[1000]).toBe("h");
  });

  it("preamble emits alt screen first, then others", () => {
    const s = createModeState();
    scanModeState("\x1b[?1000h\x1b[?1049h\x1b[?2004h", s);
    const pre = modePreamble(s);
    expect(pre.indexOf("\x1b[?1049h")).toBeLessThan(pre.indexOf("\x1b[?1000h"));
    expect(pre.indexOf("\x1b[?1000h")).toBeLessThan(pre.indexOf("\x1b[?2004h"));
  });

  it("replays a realistic opencode startup sequence", () => {
    const s = createModeState();
    // alt-screen on, cursor hide, mouse button-event tracking, SGR encoding
    scanModeState("\x1b[?1049h\x1b[?25l\x1b[?1002h\x1b[?1006h", s);
    const pre = modePreamble(s);
    expect(pre).toContain("\x1b[?1049h");
    expect(pre).toContain("\x1b[?25l");
    expect(pre).toContain("\x1b[?1002h");
    expect(pre).toContain("\x1b[?1006h");
  });
});
