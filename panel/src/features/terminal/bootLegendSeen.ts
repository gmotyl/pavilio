/**
 * The one per-browser fact the boot legend costs: has this browser been shown
 * it yet.
 *
 * ## Why it is a preference and not a `localStorage` call
 *
 * Two reasons, and the second is the one that matters.
 *
 * `no-direct-storage.test.ts` walks every tree under `src` and fails on any
 * module that says `localStorage` out loud — the tier is `preferences/`, and a
 * key written raw has no declaration, no default and no portability decision.
 * That is the rule.
 *
 * The reason behind the rule is what makes it the right shape here anyway: the
 * store owns the try/catch. A browser with storage disabled, a private window,
 * a quota that is full — each of those throws on `getItem`, and the registry
 * answers with the DECLARED DEFAULT, which is `false`. So a cell in a browser
 * that cannot remember anything degrades to "not seen", shows the legend, and
 * carries on. It never throws into a render, and it never silently suppresses
 * the legend by mistaking a broken read for a remembered one.
 *
 * ## Why the write happens when the legend is SHOWN, not when it is dismissed
 *
 * The legend teaches by being on screen; every way out of it — Escape, the
 * answer landing, pressing either control it names — is the user having seen
 * it. Waiting for a particular exit would mean picking one of them as the
 * "real" one, and a user who maximized the cell mid-boot would be taught again
 * on the next agent they start. Shown once is shown.
 */
import { preferences } from "../../preferences/declarations";
import { readPreference, writePreference } from "../../preferences/store";

/**
 * Whether this browser has already been shown the legend.
 *
 * `false` for a browser that has not, and `false` for a browser that cannot
 * say — see the note above on why those two answer the same way.
 */
export function hasSeenBootLegend(): boolean {
  return readPreference(preferences.bootLegendSeen);
}

/** Records that this browser has now been shown it. */
export function markBootLegendSeen(): void {
  writePreference(preferences.bootLegendSeen, true);
}
