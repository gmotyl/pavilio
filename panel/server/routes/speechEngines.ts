import { Router, type Response } from "express";
import { listEngines, type EngineStatus } from "anytts";
import { resolveKey, writeKeys as writeSecrets, type KeySource, type KeyVar } from "../lib/speech/secrets.js";
import { CASCADE_ORDER, KEYED_ENGINES, type KeyedEngineId, type TtsHolder } from "../lib/speech/ttsHolder.js";

/**
 * Engine status and API keys for Settings → Speech:
 *
 *   GET    /api/speech/engines      every cascade member: label, key source, status
 *   PUT    /api/speech/keys/:engine { apiKey, region? } → 204 | 400 | 409 | 500
 *   DELETE /api/speech/keys/:engine → 204 | 400 | 500
 *
 * A saved key goes to the secrets store and the server's Tts is rebuilt from
 * it. No response carries a key: GET shows only its last four characters, and
 * errors never echo the request body. A key set in the environment wins over
 * the file, so writing one there would change nothing — that answers 409.
 * DELETE always removes the file entries; an environment key stays in force.
 */

export interface SpeechEngineInfo {
  id: string;
  label: string;
  keyed: boolean;
  keySource: KeySource;
  keyLast4?: string;
  /** Azure only; the region is not a secret. */
  region?: string;
  status: EngineStatus;
}

export interface SpeechEnginesOptions {
  holder: TtsHolder;
  /** Default: the secrets store's `writeKeys`; tests inject a failing one. */
  writeKeys?: typeof writeSecrets;
}

/** The Azure engine's own region check (anytts), applied to the lowercased value. */
const AZURE_REGION = /^[a-z0-9]+$/;

const isKeyed = (id: string): id is KeyedEngineId => Object.hasOwn(KEYED_ENGINES, id);

/** The variables an engine's key occupies: Azure's region travels with its key. */
function varsOf(id: KeyedEngineId): KeyVar[] {
  return id === "azure" ? [KEYED_ENGINES.azure, "AZURE_SPEECH_REGION"] : [KEYED_ENGINES[id]];
}

/** Last four characters, only when they leave most of the key unsaid. */
function last4(value: string | undefined): string | undefined {
  return value && value.length > 8 ? value.slice(-4) : undefined;
}

export function createSpeechEnginesRouter(options: SpeechEnginesOptions): Router {
  const { holder, writeKeys = writeSecrets } = options;
  const labels = new Map(listEngines().map((e) => [e.id, e.label]));
  const router = Router();

  router.get("/engines", (_req, res) => {
    // The cascade members only: `cascade` itself has no key and its status is its members'.
    const list = CASCADE_ORDER.map((id): SpeechEngineInfo => {
      const info: SpeechEngineInfo = {
        id,
        label: labels.get(id) ?? id,
        keyed: isKeyed(id),
        keySource: "none",
        status: holder.engineStatus(id),
      };
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
      return info;
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
