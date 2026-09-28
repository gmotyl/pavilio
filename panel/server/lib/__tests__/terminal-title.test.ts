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

  it("recognises an ST-terminated title split across two chunks", () => {
    // The BEL sweep above cannot catch a split inside the ST terminator,
    // because BEL is a single byte. ST is `ESC \`, so a chunk can end on the
    // terminator's own ESC while the introducer is still further back.
    const seq = "run \x1b]0;Pavilio crash after changes\x1b\\";
    for (let i = 0; i < seq.length; i++) {
      const s = createTitleState();
      expect(scanTitle(seq.slice(0, i), s)).toBeNull();
      expect(scanTitle(seq.slice(i), s)).toBe("Pavilio crash after changes");
    }
  });

  it("carries a trailing partial sequence after a complete title", () => {
    const s = createTitleState();
    expect(scanTitle("\x1b]0;first\x07 noise \x1b]0;sec", s)).toBe("first");
    expect(scanTitle("ond\x07", s)).toBe("second");
  });

  it("strips a leading status glyph", () => {
    for (const glyph of ["◐", "◑", "✳"]) {
      const s = createTitleState();
      expect(scanTitle(`\x1b]0;${glyph} Pavilio crash after changes\x07`, s)).toBe(
        "Pavilio crash after changes",
      );
    }
  });

  it("strips a status glyph behind leading whitespace", () => {
    // The strip must survive a leading space: agents pad their title, and if
    // one space defeated the strip the glyph would flip through twice a
    // second — exactly the republish the strip exists to prevent.
    const s = createTitleState();
    expect(scanTitle("\x1b]0; ◐ Pavilio crash after changes\x07", s)).toBe(
      "Pavilio crash after changes",
    );
  });

  it("leaves a leading dollar sign intact", () => {
    const s = createTitleState();
    expect(scanTitle("\x1b]0;$ echo hi\x07", s)).toBe("$ echo hi");
  });

  it("leaves a leading currency symbol intact", () => {
    const s = createTitleState();
    expect(scanTitle("\x1b]0;€ 500 budget\x07", s)).toBe("€ 500 budget");
  });

  it("leaves a bracketed job prefix intact", () => {
    const s = createTitleState();
    expect(scanTitle("\x1b]0;[3] npm run dev\x07", s)).toBe("[3] npm run dev");
  });

  it("leaves a parenthesised env prefix intact", () => {
    const s = createTitleState();
    expect(scanTitle("\x1b]0;(base) conda env\x07", s)).toBe("(base) conda env");
  });

  it("leaves a leading path tilde intact", () => {
    const s = createTitleState();
    expect(scanTitle("\x1b]0;~/projects/pavilio\x07", s)).toBe(
      "~/projects/pavilio",
    );
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
    // The 120 here is the spec contract; every other assertion derives from
    // the exported constant so a hardcoded cut elsewhere cannot hide.
    expect(MAX_TITLE_LENGTH).toBe(120);
    expect(out).toBe("a".repeat(MAX_TITLE_LENGTH));
    expect(out).toHaveLength(MAX_TITLE_LENGTH);
  });

  it("truncates the normalised text, not the raw sequence", () => {
    const s = createTitleState();
    // Decoration to strip, a control character to fold into a space, and a
    // body longer than the cut — so truncating before normalising and
    // truncating after it produce different strings.
    const body = `◐ ${"a".repeat(100)}\n${"b".repeat(100)}`;
    const out = scanTitle(`\x1b]0;${body}\x07`, s);
    expect(out).toBe(
      `${"a".repeat(100)} ${"b".repeat(100)}`.slice(0, MAX_TITLE_LENGTH),
    );
    expect(out).toHaveLength(MAX_TITLE_LENGTH);
    expect(out).not.toContain("◐");
  });

  it("truncates an over-long title that arrived in pieces", () => {
    const s = createTitleState();
    // The body is longer than any carry bound that could plausibly be set to
    // "a title's worth of bytes" — it must still complete and be cut to 120,
    // not dropped. (Spec: an over-long title is truncated, not rejected; a
    // title may be split at any point within the sequence.)
    const head = `Pavilio ${"x".repeat(252)}`;
    const tail = "y".repeat(60);
    expect(scanTitle(`\x1b]0;${head}`, s)).toBeNull();
    expect(scanTitle(`${tail}\x07`, s)).toBe(
      `${head}${tail}`.slice(0, MAX_TITLE_LENGTH),
    );
  });

  it("never publishes a title spliced from a dropped buffer", () => {
    const s = createTitleState();
    // Past the carry bound the whole buffer is dropped, introducer included.
    // The bytes already seen are never re-attached to a later terminator, so
    // no title is published that the process did not actually send.
    expect(scanTitle(`\x1b]0;${"a".repeat(9000)}`, s)).toBeNull();
    expect(s.pending).toBe("");
    expect(scanTitle("\x07", s)).toBeNull();
    // The scanner recovers: the next well-formed sequence is read normally.
    expect(scanTitle("\x1b]0;after the drop\x07", s)).toBe("after the drop");
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
    // OSC 10 must not be mistaken for OSC 1 — the `;` in the `[012];`
    // introducer is what separates them, not any dedicated guard.
    expect(scanTitle("\x1b]10;rgb:ffff/ffff/ffff\x07", s)).toBeNull();
  });

  it("does not carry after a completed non-title sequence", () => {
    const s = createTitleState();
    // OSC 7 (cwd) and OSC 133 (shell integration marks) stream constantly in
    // a shell-integration session. They are complete sequences, so nothing
    // after them needs carrying — the introducer must not pin the carry and
    // make every later chunk of ordinary output get copied and rescanned.
    expect(scanTitle("\x1b]7;file:///home/greg\x07", s)).toBeNull();
    expect(s.pending).toBe("");
    for (let i = 0; i < 4; i++) {
      expect(scanTitle("plain output line\r\n".repeat(50), s)).toBeNull();
      expect(s.pending).toBe("");
    }
    expect(scanTitle("\x1b]133;A\x07", s)).toBeNull();
    expect(s.pending).toBe("");
    // The carry still works for a genuinely unterminated introducer.
    expect(scanTitle("\x1b]0;half", s)).toBeNull();
    expect(s.pending).toBe("\x1b]0;half");
    expect(scanTitle(" a title\x07", s)).toBe("half a title");
  });

  it("does not let an unterminated sequence grow pending without bound", () => {
    const s = createTitleState();
    // 10 KB of unterminated sequence must stay under the carry bound. The
    // literal is intentional: deriving it from the module's constant would
    // let the bound be raised without the ceiling ever being noticed.
    expect(scanTitle("\x1b]0;", s)).toBeNull();
    for (let i = 0; i < 10; i++) {
      expect(scanTitle("a".repeat(1024), s)).toBeNull();
      expect(s.pending.length).toBeLessThanOrEqual(4096);
    }
    expect(s.pending.length).toBeLessThanOrEqual(4096);
  });
});
