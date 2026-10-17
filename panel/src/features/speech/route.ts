/**
 * The speech route: how Edge synthesis reaches Microsoft, from the
 * `speech.route` preference.
 *
 * There is deliberately no "browser only" route: Microsoft refuses the Edge
 * speech socket to non-Edge browsers, so forcing direct synthesis would always
 * fail in Chrome or Firefox. `auto` already goes direct where that can work.
 *
 * A module of its own, below the seam, so the Settings picker and `synth.ts`
 * share one list while the many suites that mock `synth.ts` still get it.
 */

export type SpeechRoute = "auto" | "server";

/** The anytts edge engine `mode` each route maps onto. */
export const SPEECH_ROUTE_MODES: Record<SpeechRoute, "auto" | "relay"> = {
  auto: "auto",
  server: "relay",
};

/** The Settings picker's options, in display order. */
export const SPEECH_ROUTE_OPTIONS: readonly { id: SpeechRoute; label: string }[] = [
  { id: "auto", label: "Auto — straight from the browser in Edge, through the panel server elsewhere" },
  { id: "server", label: "Panel server — always synthesize through /api/tts" },
];

/** A stored route, or `auto` for anything this panel does not know. */
export function toSpeechRoute(stored: string): SpeechRoute {
  const known = SPEECH_ROUTE_OPTIONS.find((option) => option.id === stored);
  return known ? known.id : "auto";
}
