import { Router, type Response } from "express";
import { listEngines, type EngineStatus } from "anytts";
import { resolveKey, writeKeys as writeSecrets, type KeySource, type KeyVar } from "../lib/speech/secrets.js";
import { CASCADE_ORDER, KEYED_ENGINES, isHttpUrl, type KeyedEngineId, type TtsHolder } from "../lib/speech/ttsHolder.js";
import type { OpenaiCatalog } from "../lib/speech/openaiCatalog.js";

/**
 * Engine status and API keys for Settings → Speech:
 *
 *   GET    /api/speech/engines      every cascade member: label, key source, status
 *   PUT    /api/speech/keys/:engine { apiKey, region? } → 204 | 400 | 409 | 500
 *   PUT    /api/speech/keys/openai  { baseUrl }         → 204 | 400 | 409 | 500
 *   PUT    /api/speech/keys/kokoro  { baseUrl }         → 204 | 400 | 409 | 500
 *   DELETE /api/speech/keys/:engine → 204 | 400 | 500
 *
 * A saved key goes to the secrets store and the server's Tts is rebuilt from
 * it. No response carries a key: GET shows only its last four characters, and
 * errors never echo the request body. A key set in the environment wins over
 * the file, so writing one there would change nothing — that answers 409.
 * DELETE always removes the file entries; an environment key stays in force.
 *
 * `openai` (an OpenAI-compatible server) is always listed, so its address can be
 * set from Settings: its "key" is `OPENAI_TTS_BASE_URL`, which is not a secret,
 * so GET returns it in full and never a `keyLast4`. Until the holder configures
 * it (no address, one that is not an http(s) URL, or no voices fetched from the
 * server yet) its status is `no-key`. A saved address refreshes the live voice
 * catalog before answering, so the next GET sees the server's voices.
 *
 * `kokoro` (a Kokoro-FastAPI server) is handled the same way through
 * `KOKORO_TTS_BASE_URL`, except its catalog ships with anytts: nothing is fetched.
 */

export interface SpeechEngineInfo {
  id: string;
  label: string;
  keyed: boolean;
  keySource: KeySource;
  keyLast4?: string;
  /** Azure only; the region is not a secret. */
  region?: string;
  /** `openai` and `kokoro` only: the server address, in full (not a secret). */
  baseUrl?: string;
  status: EngineStatus;
}

export interface SpeechEnginesOptions {
  holder: TtsHolder;
  /** Default: the secrets store's `writeKeys`; tests inject a failing one. */
  writeKeys?: typeof writeSecrets;
  /** The OpenAI-compatible engine's live catalog, refreshed after its address is saved. */
  catalog?: Pick<OpenaiCatalog, "refresh">;
}

/** The Azure engine's own region check (anytts), applied to the lowercased value. */
const AZURE_REGION = /^[a-z0-9]+$/;

const isKeyed = (id: string): id is KeyedEngineId => Object.hasOwn(KEYED_ENGINES, id);

/** The members whose "key" is a server address rather than an API key. */
const ADDRESS_ENGINES = {
  openai: "OPENAI_TTS_BASE_URL",
  kokoro: "KOKORO_TTS_BASE_URL",
} as const satisfies Record<string, KeyVar>;
type AddressEngineId = keyof typeof ADDRESS_ENGINES;

const isAddressed = (id: string): id is AddressEngineId => Object.hasOwn(ADDRESS_ENGINES, id);

/** The variables an engine's key occupies: Azure's region travels with its key. */
function varsOf(id: KeyedEngineId): KeyVar[] {
  return id === "azure" ? [KEYED_ENGINES.azure, "AZURE_SPEECH_REGION"] : [KEYED_ENGINES[id]];
}

/** Last four characters, only when they leave most of the key unsaid. */
function last4(value: string | undefined): string | undefined {
  return value && value.length > 8 ? value.slice(-4) : undefined;
}

/** A hand-edited address may carry `user:pass@`; the row shows it masked, never verbatim. */
function maskCredentials(address: string): string {
  return address.replace(/^((?:[a-z][a-z0-9+.-]*:)?\/\/)?[^/?#]*@/i, "$1***@");
}

export function createSpeechEnginesRouter(options: SpeechEnginesOptions): Router {
  const { holder, writeKeys = writeSecrets, catalog } = options;
  const labels = new Map(listEngines().map((e) => [e.id, e.label]));
  const router = Router();

  /** The member's status, or undefined when the holder does not configure it. */
  const statusOf = (id: string): EngineStatus | undefined => {
    try {
      return holder.engineStatus(id);
    } catch (error) {
      if (error instanceof RangeError) return undefined;
      throw error;
    }
  };

  router.get("/engines", (_req, res) => {
    // The cascade members only: `cascade` itself has no key and its status is its members'.
    // The address engines are listed even while the holder leaves them out, so their address
    // can be set; any other member the holder does not configure is skipped.
    const list = CASCADE_ORDER.flatMap((id): SpeechEngineInfo[] => {
      const status = statusOf(id) ?? (isAddressed(id) ? { state: "no-key" as const } : undefined);
      if (!status) return [];
      const info: SpeechEngineInfo = {
        id,
        label: labels.get(id) ?? id,
        keyed: isKeyed(id) || isAddressed(id),
        keySource: "none",
        status,
      };
      if (isAddressed(id)) {
        // Shown even when it is not a URL (a hand-edited file), so it can be fixed.
        const address = resolveKey(ADDRESS_ENGINES[id]);
        info.keySource = address.source;
        if (address.value) info.baseUrl = maskCredentials(address.value);
      }
      if (isKeyed(id)) {
        const key = resolveKey(KEYED_ENGINES[id]);
        info.keySource = key.source;
        const keyLast4 = last4(key.value);
        if (keyLast4) info.keyLast4 = keyLast4;
        if (id === "azure") {
          const region = resolveKey("AZURE_SPEECH_REGION").value;
          if (region) info.region = region;
        }
      }
      return [info];
    });
    res.json(list);
  });

  /** Writes (or removes) the entries and rebuilds the instance; false after answering 500. */
  async function save(
    entries: Partial<Record<KeyVar, string | null>>,
    res: Response,
  ): Promise<boolean> {
    try {
      await writeKeys(entries);
      holder.rebuild();
      return true;
    } catch {
      // The error may quote what was written; log and answer without it.
      console.error("[speech] could not save the engine key");
      res.status(500).json({ error: "could not save the key" });
      return false;
    }
  }

  for (const id of Object.keys(ADDRESS_ENGINES) as AddressEngineId[]) {
    const name = ADDRESS_ENGINES[id];
    router.put(`/keys/${id}`, async (req, res) => {
      const body = (req.body ?? {}) as { baseUrl?: unknown };
      const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
      if (!baseUrl || /[\r\n]/.test(baseUrl) || !isHttpUrl(baseUrl)) {
        const example = id === "kokoro" ? "http://127.0.0.1:8880" : "http://127.0.0.1:8890";
        res.status(400).json({ error: `baseUrl must be an http(s) URL without credentials, e.g. ${example}` });
        return;
      }
      if (resolveKey(name).source === "env") {
        res.status(409).json({ error: "the address is set in the server environment" });
        return;
      }
      if (!(await save({ [name]: baseUrl }, res))) return;
      // The new address may be a different server: fetch its voices. A changed list rebuilds the
      // holder through the catalog's onChange; refresh never rejects (3 s timeout at worst).
      if (id === "openai") await catalog?.refresh();
      res.status(204).end();
    });

    router.delete(`/keys/${id}`, async (_req, res) => {
      if (await save({ [name]: null }, res)) res.status(204).end();
    });
  }

  router.put("/keys/:engine", async (req, res) => {
    const id = req.params.engine;
    if (!isKeyed(id)) {
      res.status(400).json({ error: "unknown or keyless engine" });
      return;
    }
    const body = (req.body ?? {}) as { apiKey?: unknown; region?: unknown };
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!apiKey || /[\r\n]/.test(apiKey)) {
      res.status(400).json({ error: "apiKey must be a non-empty single-line string" });
      return;
    }
    const entries: Partial<Record<KeyVar, string>> = { [KEYED_ENGINES[id]]: apiKey };
    if (id === "azure") {
      const region = typeof body.region === "string" ? body.region.trim().toLowerCase() : "";
      if (!AZURE_REGION.test(region)) {
        res.status(400).json({ error: "azure needs a region (letters and digits, e.g. westeurope)" });
        return;
      }
      entries.AZURE_SPEECH_REGION = region;
    }
    if (varsOf(id).some((name) => resolveKey(name).source === "env")) {
      res.status(409).json({ error: "the key is set in the server environment" });
      return;
    }
    if (await save(entries, res)) res.status(204).end();
  });

  router.delete("/keys/:engine", async (req, res) => {
    const id = req.params.engine;
    if (!isKeyed(id)) {
      res.status(400).json({ error: "unknown or keyless engine" });
      return;
    }
    const entries = Object.fromEntries(varsOf(id).map((name) => [name, null]));
    if (await save(entries, res)) res.status(204).end();
  });

  return router;
}
