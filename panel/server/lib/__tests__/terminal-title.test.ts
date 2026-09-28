import { describe, it, expect } from "vitest";
import {
  createTitleState,
  scanTitle,
  MAX_TITLE_LENGTH,
} from "../terminal-title";

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\x00-\x1f\x7f]/;

describe("terminal-title", () => {
  it("reads a BEL-terminated title", () => {
    const s = createTitleState();
    expect(scanTitle("\x1b]0;Pavilio crash after changes\x07", s)).toBe(
      "Pavilio crash after changes",
    );
  });

  it("reads an ST-terminated title", () => {
    const s = createTitleState();
    expect(scanTitle("\x1b]0;Pavilio crash after changes\x1b\\", s)).toBe(
      "Pavilio crash after changes",
    );
  });

  it("reads titles set with OSC 1 and OSC 2", () => {
    const one = createTitleState();
    expect(scanTitle("\x1b]1;Pavilio crash after changes\x07", one)).toBe(
      "Pavilio crash after changes",
    );
    const two = createTitleState();
    expect(scanTitle("\x1b]2;Pavilio crash after changes\x07", two)).toBe(
      "Pavilio crash after changes",
    );
  });

  it("returns only the last title when a chunk holds several", () => {
    const s = createTitleState();
    const chunk =
      "\x1b]0;first\x07 noise \x1b]2;second\x1b\\ more \x1b]1;third\x07";
    expect(scanTitle(chunk, s)).toBe("third");
  });

  it("recognises a title split across two chunks", () => {
    const seq = "run \x1b]0;Pavilio crash after changes\x07";
    for (let i = 0; i < seq.length; i++) {
      const s = createTitleState();
      expect(scanTitle(seq.slice(0, i), s)).toBeNull();
      expect(scanTitle(seq.slice(i), s)).toBe("Pavilio crash after changes");
    }
  });

  it("strips a leading status glyph", () => {
    for (const glyph of ["◐", "◑", "✳"]) {
      const s = createTitleState();
      expect(scanTitle(`\x1b]0;${glyph} Pavilio crash after changes\x07`, s)).toBe(
        "Pavilio crash after changes",
      );
    }
  });

  it("reports no change when only the animating prefix differs", () => {
    const s = createTitleState();
    const first = scanTitle("\x1b]0;◐ Pavilio crash after changes\x07", s);
    const second = scanTitle("\x1b]0;◑ Pavilio crash after changes\x07", s);
    expect(first).toBe("Pavilio crash after changes");
    expect(second).toBe(first);
  });

  it("removes control characters and newlines", () => {
    const s = createTitleState();
    const out = scanTitle("\x1b]0;build\nfailed\x01 badly\x07", s);
    expect(out).toBe("build failed badly");
    expect(CONTROL_RE.test(out as string)).toBe(false);
  });

  it("truncates at 120 characters", () => {
    const s = createTitleState();
    const long = "a".repeat(200);
    const out = scanTitle(`\x1b]0;${long}\x07`, s);
    expect(MAX_TITLE_LENGTH).toBe(120);
    expect(out).toBe("a".repeat(120));
    expect(out).toHaveLength(MAX_TITLE_LENGTH);
  });

  it("returns an empty string for an emptied title", () => {
    const s = createTitleState();
    expect(scanTitle("\x1b]0;\x07", s)).toBe("");
  });

  it("returns null for a chunk with no title sequence", () => {
    const s = createTitleState();
    expect(scanTitle("plain output\r\n", s)).toBeNull();
    // Other OSC commands (here: OSC 7, current working directory) are not titles.
    expect(scanTitle("\x1b]7;file:///home/greg\x07", s)).toBeNull();
    // OSC 10 must not be mistaken for OSC 1.
    expect(scanTitle("\x1b]10;rgb:ffff/ffff/ffff\x07", s)).toBeNull();
  });

  it("does not let an unterminated sequence grow pending without bound", () => {
    const s = createTitleState();
    expect(scanTitle("\x1b]0;", s)).toBeNull();
    for (let i = 0; i < 10; i++) {
      expect(scanTitle("a".repeat(1024), s)).toBeNull();
      expect(s.pending.length).toBeLessThanOrEqual(256);
    }
    expect(s.pending.length).toBeLessThanOrEqual(256);
  });
});
