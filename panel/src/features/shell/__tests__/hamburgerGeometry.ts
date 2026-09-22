import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The hamburger's geometry, read back out of the stylesheet that owns it.
 *
 * jsdom does no layout and loads no stylesheet, so a test there cannot ask
 * where anything is. What it CAN do is take the two halves of the arrangement
 * — the constants `index.css` positions the fixed button with, and the boxes
 * the components put in flow beside it — and check that they still add up.
 * That is the mechanism these files pin; the browser hit-test in the task's
 * verification is what confirms the mechanism describes reality.
 *
 * Read from the package root: vitest's `root` is `panel/`, and
 * `import.meta.url` is not a file URL under its transform.
 */
const CSS = readFileSync(resolve("src/index.css"), "utf8");

/**
 * One class's declaration block. Throws rather than silently matching none —
 * and, just as importantly, rather than silently matching the wrong one.
 *
 * This reads declarations, not the cascade: it has no way to decide which of
 * several blocks for a selector wins at any given viewport. The old version
 * took the FIRST match, so an `@media` override written above the base rule —
 * or a second rule anywhere in the file — would be read as though it were the
 * whole story, and every constant derived from it would agree with a
 * stylesheet that no longer says what the number claims. An ambiguity this
 * helper cannot resolve is one it must refuse, so more than one match is an
 * error with a name rather than a guess with a green tick.
 *
 * The leading `(?:^|[\s,{}])` is what keeps `.sidebar-hamburger` from matching
 * inside a longer class name; a `:hover` or `-slot` suffix is already excluded
 * by the `\s*\{` that follows.
 */
export function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|[\\s,{}])${escaped}\\s*\\{([^}]*)\\}`, "g");
  const found = [...CSS.matchAll(pattern)];
  if (found.length === 0) {
    throw new Error(`no rule for ${selector} in src/index.css`);
  }
  if (found.length > 1) {
    throw new Error(
      `${found.length} rules for ${selector} in src/index.css — a media ` +
        `override or a duplicate. This helper reads declarations, not the ` +
        `cascade, so it cannot say which one applies.`,
    );
  }
  return found[0][1];
}

/** One pixel-valued declaration from that block. */
export function cssPx(selector: string, property: string): number {
  const found = cssRule(selector).match(
    new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*(-?[\\d.]+)px`),
  );
  if (!found) {
    throw new Error(`no ${property} in ${selector} — expected a px value`);
  }
  return Number(found[1]);
}

/** Where the fixed button is, and how big. */
export const HAMBURGER = {
  left: cssPx(".sidebar-hamburger", "left"),
  top: cssPx(".sidebar-hamburger", "top"),
  width: cssPx(".sidebar-hamburger", "width"),
  height: cssPx(".sidebar-hamburger", "height"),
};

/** The box the sidebar's first header row keeps for it. */
export const SLOT = {
  width: cssPx(".sidebar-hamburger-slot", "width"),
  height: cssPx(".sidebar-hamburger-slot", "height"),
};

/** The box a left-docked drawer's header row keeps for it. */
export const DRAWER_GAP = {
  width: cssPx(".drawer-hamburger-gap", "width"),
};

/**
 * Tailwind spacing in px. The scale is `n * 0.25rem`, and the panel never
 * moves the root font size off 16px, so a unit is 4px.
 */
const UNIT = 4;

/** The left inset a `p-N`, `px-N` or `pl-N` class puts on an element. */
export function leftPadding(el: Element): number {
  const found = el.className.match(/(?:^|\s)p[xl]?-(\d+)(?:\s|$)/);
  return found ? Number(found[1]) * UNIT : 0;
}

/** The `gap-N` a flex row puts between its children. */
export function flexGap(el: Element): number {
  const found = el.className.match(/(?:^|\s)gap-(\d+)(?:\s|$)/);
  return found ? Number(found[1]) * UNIT : 0;
}

/**
 * The width of one in-flow item in a header row.
 *
 * Only two kinds appear there: the reserved slot, whose size is the stylesheet
 * constant above, and a lucide icon, which renders the `size` prop as explicit
 * `width`/`height` attributes. Anything else has to be taught to this function
 * before the arithmetic below can claim to know where the heading lands.
 */
export function rowItemWidth(el: Element): number {
  if (el.classList.contains("sidebar-hamburger-slot")) return SLOT.width;
  const attr = el.getAttribute("width");
  if (attr !== null) return Number(attr);
  throw new Error(
    `no measurable width for <${el.tagName.toLowerCase()} class="${el.className}">`,
  );
}

/**
 * Where a heading in the sidebar's header row starts, in viewport px.
 *
 * Summed the way the browser lays the row out: the scrolling column's padding,
 * the row's own padding, then every item before the heading plus the row's gap
 * after each. The column is found by its `overflow-auto` rather than by a fixed
 * number of `parentElement` hops, so a wrapper added between them cannot make
 * this arithmetic quietly answer for the wrong box.
 */
export function headingOriginX(heading: Element): number {
  const row = heading.parentElement;
  if (!row) throw new Error("the heading is not in a row");
  const column = row.closest(".overflow-auto");
  if (!column) throw new Error("the heading's row is not in a scrolling column");

  let x = leftPadding(column) + leftPadding(row);
  const gap = flexGap(row);
  for (const item of Array.from(row.children)) {
    if (item === heading) return x;
    x += rowItemWidth(item) + gap;
  }
  throw new Error("the heading is not among its row's children");
}
