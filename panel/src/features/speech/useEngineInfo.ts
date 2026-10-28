/**
 * What the panel server knows about each cascade member — label, where its key
 * comes from, the key's last four characters, Azure's region and anytts'
 * `engineStatus` — from `GET /api/speech/engines`.
 *
 * Fetched once when a surface mounts and again after a key change, never
 * polled: the status is a hint for a settings screen, and a stale chip costs
 * nothing a reopen does not fix.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type KeySource = "env" | "file" | "none";

export type EngineState = "ready" | "no-key" | "quota-exhausted" | "rate-limited" | "unauthorized";

export interface EngineInfo {
  id: string;
  label: string;
  keyed: boolean;
  keySource: KeySource;
  keyLast4?: string;
  /** Azure only; the region is not a secret. */
  region?: string;
  status: { state: EngineState; until?: string };
}

/** Keyed engine id → the server variable that, when set, wins over a saved key. */
export const ENGINE_KEY_VARS: Readonly<Record<string, string>> = {
  elevenlabs: "ELEVENLABS_API_KEY",
  cartesia: "CARTESIA_API_KEY",
  speechify: "SPEECHIFY_API_KEY",
  azure: "AZURE_SPEECH_KEY",
};

/** Whether `id` is an engine that needs an API key (every member but Edge). */
export function isKeyedEngine(id: string): boolean {
  return Object.hasOwn(ENGINE_KEY_VARS, id);
}

/**
 * Whether the cascade skips `info`'s engine for want of a key: a keyed engine
 * with no key anywhere. Unknown (`undefined`, the list not loaded yet) is not
 * keyless — a row is greyed only on the server's word.
 */
export function isKeyless(info: EngineInfo | undefined): boolean {
  return info !== undefined && info.keyed && info.keySource === "none";
}

export type ChipTone = "ok" | "warn" | "off" | "err";

/** "1 Nov": the day a skip window closes, in the viewer's time zone. */
function shortDate(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** The status chip's words and tone for an engine status (mockup copy). */
export function statusChip(status: EngineInfo["status"]): { text: string; tone: ChipTone } {
  switch (status.state) {
    case "ready":
      return { text: "ready", tone: "ok" };
    case "quota-exhausted": {
      const back = shortDate(status.until);
      return { text: back ? `quota used · back ${back}` : "quota used", tone: "warn" };
    }
    case "rate-limited":
      return { text: "rate-limited", tone: "warn" };
    case "unauthorized":
      return { text: "bad key", tone: "err" };
    case "no-key":
      return { text: "no key · skipped", tone: "off" };
    default:
      return { text: "unknown", tone: "off" };
  }
}

function isEngineInfo(value: unknown): value is EngineInfo {
  if (value === null || typeof value !== "object") return false;
  const info = value as Partial<EngineInfo>;
  return (
    typeof info.id === "string" &&
    typeof info.keyed === "boolean" &&
    typeof info.keySource === "string" &&
    info.status !== null &&
    typeof info.status === "object" &&
    typeof info.status.state === "string"
  );
}

export interface EngineInfoState {
  /** id → info; `null` until the first answer (or after it failed). */
  engines: Readonly<Record<string, EngineInfo>> | null;
  /** The last fetch failed or answered something that is not the list. */
  failed: boolean;
  /** Fetches the list again — after a key was saved or removed. */
  refresh: () => Promise<void>;
}

export function useEngineInfo(): EngineInfoState {
  const [engines, setEngines] = useState<Readonly<Record<string, EngineInfo>> | null>(null);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);
  // Refreshes overlap (the mount fetch, then one after a key save); only the
  // latest one's answer or failure is applied, whatever order they land in.
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++latest.current;
    const current = () => mounted.current && seq === latest.current;
    try {
      const res = await fetch("/api/speech/engines");
      const body: unknown = res.ok ? await res.json() : null;
      if (!current()) return;
      if (!Array.isArray(body)) throw new Error("not a list");
      setEngines(Object.fromEntries(body.filter(isEngineInfo).map((info) => [info.id, info])));
      setFailed(false);
    } catch {
      if (current()) setFailed(true);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  return { engines, failed, refresh };
}
