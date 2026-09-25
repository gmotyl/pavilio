// The client end of one tuning knob: how long a busy transition must persist
// before it may take the answer pane's body.
//
// Leaf module — it imports nothing, so every caller that needs the window can
// read it without dragging a dependency in, the way `watchdogConfig` serves the
// mobile watchdog.
//
// The value is SERVER-SIDE and arrives on `GET /api/preferences.js`, the
// parser-blocking script the page already loads before React mounts. That is
// deliberate: a `VITE_*` variable would be baked into the bundle, so changing
// it would mean a rebuild — on this workspace a pull plus a manual restart —
// whereas this changes with `PAVILIO_ANSWER_WAVE_DEBOUNCE_MS` and a panel
// restart alone. It is a knob, not a user setting, so it is not a declared
// preference and gets no Settings control.

declare global {
  /**
   * Server-side tuning values, injected into the page by
   * `GET /api/preferences.js` alongside `window.__PAVILIO_PREFS__`. Absent in
   * node, and absent in any page that did not load that script.
   */
  // `var`, not `const`/`let`: only a `var` declaration puts the name on
  // `globalThis`, which is how this is read (there may be no `window`).
  var __PAVILIO_TUNING__: { answerWaveDebounceMs?: unknown } | undefined;
}

/**
 * The window used when the document says nothing — which is a real case, not a
 * defensive one: a page whose boot document predates the key (an older panel
 * behind a newer bundle), and a page whose request for that script was refused.
 * The server spells the same number in `panel.config.ts`; neither side can
 * import the other's module, and this copy covers documents the server never
 * produced.
 */
export const DEFAULT_ANSWER_WAVE_DEBOUNCE_MS = 3000;

/**
 * The configured debounce, in milliseconds.
 *
 * Reached through `globalThis` (never a bare `window`) so an absent global is
 * `undefined` rather than a ReferenceError, and read per call rather than baked
 * in at import time — which is also what lets a test set the document and see
 * it without re-importing the module.
 *
 * The guard repeats the server's, on purpose. A zero or negative window is not
 * a shorter debounce but NO debounce, which silently restores the reattach
 * false positive this exists to stop, and a NaN would make every comparison
 * against it false. A document carrying one of those is broken, and the honest
 * answer to a broken document is the default rather than a disabled feature.
 */
export function answerWaveDebounceMs(): number {
  const tuning = (globalThis as { __PAVILIO_TUNING__?: unknown }).__PAVILIO_TUNING__;
  if (tuning === null || typeof tuning !== "object") return DEFAULT_ANSWER_WAVE_DEBOUNCE_MS;

  const value = (tuning as { answerWaveDebounceMs?: unknown }).answerWaveDebounceMs;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_ANSWER_WAVE_DEBOUNCE_MS;
  }
  return value;
}
