/**
 * A disabled control on the speech row has to be VISIBLE.
 *
 * The row's own rule says the transport is disabled rather than hidden before
 * the first answer, and says why in as many words: *"Disabled says **not yet**
 * where hiding said **never**."* That sentence has been false in the rendering
 * since the row was built. `.speech-bar-btn[disabled]` is `opacity: 0.32`, and
 * over the row's `#17171d` the glyph composites to `rgb(66,65,68)` — a contrast
 * ratio of 1.76:1 against its own background.
 *
 * Measured, not guessed. Greg reported the arrows "disappeared totally" on
 * mobile; at a 390x844 viewport on the live panel they were laid out exactly
 * where the desktop puts them — `x 65, w 44, display grid, visibility visible`,
 * row `scrollWidth === clientWidth`, nothing clipped — and disabled. A phone is
 * simply where 1.76:1 stops being a faint smudge and becomes nothing at all.
 *
 * So the floor is asserted here rather than left to the eye. WCAG 2.1 SC 1.4.11
 * asks **3:1** of a non-text UI component, which is the number this file pins.
 * Disabled still reads as disabled: the enabled glyph is 6.43:1, and the state
 * keeps its other two signals — no hover response, and `cursor: default`.
 *
 * ## What this proves, and what it does not
 *
 * jsdom lays nothing out and composites nothing, so this is the CASCADE and the
 * arithmetic, in the same discipline `SpeechControlBar.alwaysTransport.test.tsx`
 * uses for the row's height: the shipped `src/index.css` goes into the document
 * and `getComputedStyle` is asked on real elements. It cannot prove what a
 * screen paints. It can prove that the two numbers a painter would combine are
 * not the two that produced 1.76:1.
 *
 * `color` comes back from jsdom as the literal `var(--text-secondary)` — it
 * resolves custom properties on the element that DECLARES them, not through a
 * `var()` in a longhand — so the token is read off `:root` and substituted
 * here. That substitution is the one hand-done step, and it is the same one the
 * browser makes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "..", "..", "index.css"), "utf8");

/** WCAG 2.1 SC 1.4.11, non-text contrast. */
const UI_CONTRAST_FLOOR = 3;

let stylesheet: HTMLStyleElement;

beforeEach(() => {
  stylesheet = document.createElement("style");
  stylesheet.textContent = css;
  document.head.append(stylesheet);
});

afterEach(() => {
  stylesheet.remove();
  document.body.replaceChildren();
});

type Rgb = [number, number, number];

const parseRgb = (value: string): Rgb => {
  const hex = value.trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const parts = value.match(/[\d.]+/g);
  if (!parts || parts.length < 3) throw new Error(`not a colour: ${value}`);
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
};

/** WCAG relative luminance. */
const luminance = ([r, g, b]: Rgb): number => {
  const channel = (raw: number): number => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const contrast = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** What the painter ends up with: the glyph's colour at its opacity, over the row. */
const composite = (fg: Rgb, bg: Rgb, alpha: number): Rgb =>
  fg.map((c, i) => c * alpha + bg[i] * (1 - alpha)) as Rgb;

/** The row and one control inside it, styled by the shipped sheet. */
function renderControl(disabled: boolean): { glyph: Rgb; row: Rgb; alpha: number } {
  const bar = document.createElement("div");
  bar.className = "speech-bar";
  const button = document.createElement("button");
  button.className = "speech-bar-btn";
  if (disabled) button.setAttribute("disabled", "");
  bar.append(button);
  document.body.append(bar);

  const buttonStyle = getComputedStyle(button);
  // See the note on this file: jsdom hands `var(--text-secondary)` back
  // unresolved from a longhand, so the token is read where it is declared.
  const token = getComputedStyle(document.documentElement).getPropertyValue("--text-secondary");
  return {
    glyph: parseRgb(token),
    row: parseRgb(getComputedStyle(bar).backgroundColor),
    alpha: Number(buttonStyle.opacity),
  };
}

describe("a disabled control on the speech row stays visible", () => {
  it("clears the non-text contrast floor against the row it sits on", () => {
    const { glyph, row, alpha } = renderControl(true);

    // The state IS dimmed — this is not a test that deletes the distinction.
    expect(alpha).toBeLessThan(1);

    const painted = composite(glyph, row, alpha);
    expect(contrast(painted, row)).toBeGreaterThanOrEqual(UI_CONTRAST_FLOOR);
  });

  it("still reads as weaker than an enabled control", () => {
    const disabled = renderControl(true);
    const enabled = renderControl(false);

    // "Disabled says not yet" needs BOTH halves: legible, and legibly less.
    // Without this a fix could satisfy the floor by simply deleting the dim.
    const disabledContrast = contrast(
      composite(disabled.glyph, disabled.row, disabled.alpha),
      disabled.row,
    );
    const enabledContrast = contrast(
      composite(enabled.glyph, enabled.row, enabled.alpha),
      enabled.row,
    );
    expect(disabledContrast).toBeLessThan(enabledContrast * 0.75);
  });
});
