/**
 * What the Voices section ({@link import("./VoicesSection").VoicesSection}) and its add form share:
 * the route, the control styles (the same tokens `EngineSettings.tsx` uses), and how a failed
 * request reads in the red banner.
 */
import type { CSSProperties } from "react";

export const VOICES_URL = "/api/speech/openai/voices";

export const CONTROL_CLASS = "text-sm px-2 py-1.5 rounded";
export const CONTROL_STYLE: CSSProperties = {
  background: "var(--bg-surface)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-subtle)",
  width: "100%",
  minWidth: 0,
};
export const BUTTON_CLASS = "text-xs px-2.5 py-1 rounded";
export const BUTTON_STYLE: CSSProperties = {
  background: "var(--bg-surface)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-subtle)",
};
export const PRIMARY_STYLE: CSSProperties = {
  background: "var(--accent)",
  color: "#1a1408",
  border: "1px solid var(--accent)",
  fontWeight: 600,
};
export const LABEL_CLASS = "block text-xs mb-1";
export const MUTED: CSSProperties = { color: "var(--text-muted)" };
export const RED: CSSProperties = { color: "var(--red)" };

/** The line a red banner shows for a voice route that did not succeed. */
export async function failureOf(res: Response): Promise<string> {
  let body: { error?: unknown; detail?: unknown } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // Not JSON: the status line below has to do.
  }
  if (typeof body.detail === "string" && body.detail !== "") return body.detail;
  if (res.status === 413) return "The sample is too large — 25 MB at most.";
  if (body.error === "unreachable") return "Can't reach the OmniVoice server.";
  if (body.error === "no-address") return "No OmniVoice server address is set.";
  return `The OmniVoice server refused the request (HTTP ${res.status}).`;
}

export const PANEL_DOWN = "Could not reach the panel server.";
