import { useSyncExternalStore } from "react";

export type PanelTheme = "dark" | "light";

/**
 * The colour a project's NAME is drawn in. On a dark surface the project colour
 * itself reads well; on a light one the same pastel washes out, so it is mixed
 * 72% toward black to keep the text's contrast. One helper, so the light-theme
 * mix lives in one place for every surface that colours a name.
 */
export function nameColor(hex: string, theme: PanelTheme): string {
  return theme === "light" ? `color-mix(in srgb, ${hex} 72%, black)` : hex;
}

/**
 * The panel is dark unless the root element says otherwise: `data-theme="light"`
 * on `<html>` is the one switch a light theme flips. Nothing sets it today, so
 * this answers "dark" — but every name-colouring surface already reads it, live.
 */
function readTheme(): PanelTheme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

/** The current panel theme, kept live across a `data-theme` change. */
export function usePanelTheme(): PanelTheme {
  return useSyncExternalStore(subscribe, readTheme, () => "dark");
}
