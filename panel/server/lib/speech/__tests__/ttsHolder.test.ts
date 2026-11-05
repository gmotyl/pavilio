import { describe, it, expect, vi } from "vitest";
import { createTts } from "anytts/server";
import { resolveVoice, type TtsConfig } from "anytts";
import { createTtsHolder, KOKORO_FIRST_BYTE_TIMEOUT_MS } from "../ttsHolder";
import type { KeyVar, KeySource } from "../secrets";
import {
  OPENAI_FIRST_BYTE_TIMEOUT_MS,
  type OmniVoiceInfo,
} from "../../../../src/features/speech/openaiVoices";

/** A live catalog as the holder reads it: just `current()`. */
function liveCatalog(voices: OmniVoiceInfo[]) {
  return { current: () => voices };
}

const PL_FEMALE: OmniVoiceInfo = {
  id: "pl-female",
  locale: "pl-PL",
  gender: "female",
  label: "Polish, young",
  multilingual: false,
  source: "bundled",
};
const EN_MALE: OmniVoiceInfo = {
  id: "en-male",
  locale: "en-US",
  gender: "male",
  label: "American, low",
  multilingual: false,
  source: "bundled",
};
const MY_VOICE: OmniVoiceInfo = {
  id: "my-voice",
  locale: "pl-PL",
  gender: "male",
  label: "My voice (own recording)",
  multilingual: true,
  source: "custom",
};

/** A `resolveKey` over a fixed table, standing in for env + secrets file. */
function keys(table: Partial<Record<KeyVar, string>>) {
  return (name: KeyVar): { value?: string; source: KeySource } =>
    table[name] ? { value: table[name], source: "file" } : { source: "none" };
}

describe("server Tts holder", () => {
  it("builds one instance with keyed engines, edge and cascade", () => {
    const configs: TtsConfig[] = [];
    const factory = vi.fn((config: TtsConfig) => {
      configs.push(config);
      return createTts(config);
    });

    const holder = createTtsHolder({
      createTts: factory,
      resolveKey: keys({
        ELEVENLABS_API_KEY: "el-key",
        AZURE_SPEECH_KEY: "az-key",
        AZURE_SPEECH_REGION: "westeurope",
      }),
    });

    expect(factory).toHaveBeenCalledTimes(1);
    const { engines, defaultEngine } = configs[0]!;
    expect(Object.keys(engines).sort()).toEqual(
      ["azure", "cartesia", "cascade", "edge", "elevenlabs", "speechify"].sort(),
    );
    expect(engines.cascade).toEqual({
      order: ["elevenlabs", "cartesia", "speechify", "azure", "edge"],
    });
    expect(engines.elevenlabs).toMatchObject({ apiKey: "el-key" });
    expect(engines.azure).toMatchObject({ apiKey: "az-key", region: "westeurope" });
    expect(engines.cartesia?.apiKey).toBeUndefined();
    expect(defaultEngine).toBe("edge");

    // The same instance answers until a rebuild; keyless engines report no-key.
    const tts = holder.current();
    expect(holder.current()).toBe(tts);
    expect(holder.engineStatus("elevenlabs")).toEqual({ state: "ready" });
    expect(holder.engineStatus("azure")).toEqual({ state: "ready" });
    expect(holder.engineStatus("cartesia")).toEqual({ state: "no-key" });
    expect(holder.engineStatus("edge")).toEqual({ state: "ready" });
    expect(factory).toHaveBeenCalledTimes(1);

    // Azure with a key but no usable region would make createTts throw: it is
    // configured keyless instead, so the server still starts.
    const noRegion = createTtsHolder({
      createTts: factory,
      resolveKey: keys({ AZURE_SPEECH_KEY: "az-key", AZURE_SPEECH_REGION: "West Europe!" }),
    });
    expect(configs[1]!.engines.azure?.apiKey).toBeUndefined();
    expect(noRegion.engineStatus("azure")).toEqual({ state: "no-key" });
  });

  it("warns once, naming only the variable, when the azure region is unusable", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      createTtsHolder({
        createTts,
        resolveKey: keys({ AZURE_SPEECH_KEY: "secret-az-key", AZURE_SPEECH_REGION: "West Europe!" }),
      });
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0]![0]);
      expect(message).toContain("AZURE_SPEECH_REGION");
      expect(message).not.toContain("secret-az-key");
      expect(message).not.toContain("West Europe!");

      // A missing region warns too; a usable one, or no key at all, does not.
      warn.mockClear();
      createTtsHolder({ createTts, resolveKey: keys({ AZURE_SPEECH_KEY: "secret-az-key" }) });
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockClear();
      createTtsHolder({
        createTts,
        resolveKey: keys({ AZURE_SPEECH_KEY: "secret-az-key", AZURE_SPEECH_REGION: "westeurope" }),
      });
      createTtsHolder({ createTts, resolveKey: keys({ AZURE_SPEECH_REGION: "nope!" }) });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
  it("holder configures openai with the live catalog and resolved map", () => {
    const configs: TtsConfig[] = [];
    let voices = [EN_MALE, PL_FEMALE];
    const holder = createTtsHolder({
      createTts: (config) => {
        configs.push(config);
        return createTts(config);
      },
      resolveKey: keys({ OPENAI_TTS_BASE_URL: "http://127.0.0.1:8890" }),
      catalog: { current: () => voices },
    });

    // No `my-voice` on this server: every default falls back against the live catalog.
    expect(configs[0]!.engines.openai).toEqual({
      baseUrl: "http://127.0.0.1:8890",
      catalog: [EN_MALE, PL_FEMALE],
      voices: { pl: "pl-female", en: "en-male", default: "en-male" },
      languageField: "language",
      firstByteMs: OPENAI_FIRST_BYTE_TIMEOUT_MS,
      retries: 0,
    });
    // A local server needs no key: it leads the cascade, ready.
    expect(configs[0]!.engines.cascade).toEqual({
      order: ["openai", "elevenlabs", "cartesia", "speechify", "azure", "edge"],
    });
    expect(holder.engineStatus("openai")).toEqual({ state: "ready" });

    // A rebuild reads the catalog as it is now: `my-voice` arrived, so it speaks every language.
    voices = [EN_MALE, PL_FEMALE, MY_VOICE];
    holder.rebuild();
    expect(configs[1]!.engines.openai).toMatchObject({
      catalog: [EN_MALE, PL_FEMALE, MY_VOICE],
      voices: { pl: "my-voice", en: "my-voice", default: "my-voice" },
    });
    expect(resolveVoice(holder.current(), { engine: "openai", lang: "pl" }).voice).toBe("my-voice");

    // An empty catalog (server down at boot): anytts needs at least one voice, so openai stays
    // out of the instance until a refresh brings voices and the holder is rebuilt.
    const empty = createTtsHolder({
      createTts: (config) => {
        configs.push(config);
        return createTts(config);
      },
      resolveKey: keys({ OPENAI_TTS_BASE_URL: "http://127.0.0.1:8890" }),
      catalog: liveCatalog([]),
    });
    expect(Object.hasOwn(configs[2]!.engines, "openai")).toBe(false);
    expect(configs[2]!.engines.cascade).toEqual({ order: ["elevenlabs", "cartesia", "speechify", "azure", "edge"] });
    expect(() => empty.engineStatus("openai")).toThrow(RangeError);
  });

  it("leaves openai out when the address is unset", () => {
    const configs: TtsConfig[] = [];
    const holder = createTtsHolder({
      createTts: (config) => {
        configs.push(config);
        return createTts(config);
      },
      resolveKey: keys({}),
    });

    const { engines } = configs[0]!;
    expect(Object.hasOwn(engines, "openai")).toBe(false);
    // The cascade holds only configured engines; anytts would throw on an unknown member.
    expect(engines.cascade).toEqual({ order: ["elevenlabs", "cartesia", "speechify", "azure", "edge"] });
    expect(() => holder.engineStatus("openai")).toThrow(RangeError);
  });

  it("an invalid address warns without the value and leaves openai out", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const configs: TtsConfig[] = [];
      const build = () =>
        createTtsHolder({
          createTts: (config) => {
            configs.push(config);
            return createTts(config);
          },
          resolveKey: keys({ OPENAI_TTS_BASE_URL: "not a url" }),
        });
      expect(build).not.toThrow();

      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0]![0]);
      expect(message).toContain("OPENAI_TTS_BASE_URL");
      expect(message).not.toContain("not a url");
      expect(Object.hasOwn(configs[0]!.engines, "openai")).toBe(false);
      expect(configs[0]!.engines.cascade).toEqual({
        order: ["elevenlabs", "cartesia", "speechify", "azure", "edge"],
      });

      // Not http(s) is no better than not a URL.
      warn.mockClear();
      createTtsHolder({ createTts, resolveKey: keys({ OPENAI_TTS_BASE_URL: "ftp://127.0.0.1:8890" }) });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
  it("configures kokoro when KOKORO_TTS_BASE_URL is set", () => {
    const configs: TtsConfig[] = [];
    const holder = createTtsHolder({
      createTts: (config) => {
        configs.push(config);
        return createTts(config);
      },
      resolveKey: keys({ KOKORO_TTS_BASE_URL: "http://127.0.0.1:8880" }),
    });

    expect(KOKORO_FIRST_BYTE_TIMEOUT_MS).toBe(30000);
    expect(configs[0]!.engines.kokoro).toEqual({ baseUrl: "http://127.0.0.1:8880", firstByteMs: 30000, retries: 0 });
    expect(configs[0]!.engines.cascade).toEqual({
      order: ["kokoro", "elevenlabs", "cartesia", "speechify", "azure", "edge"],
    });
    expect(holder.engineStatus("kokoro")).toEqual({ state: "ready" });
  });

  it("leaves kokoro out when the address is unset", () => {
    const configs: TtsConfig[] = [];
    const holder = createTtsHolder({
      createTts: (config) => {
        configs.push(config);
        return createTts(config);
      },
      resolveKey: keys({}),
    });

    expect(Object.hasOwn(configs[0]!.engines, "kokoro")).toBe(false);
    expect(configs[0]!.engines.cascade).toEqual({
      order: ["elevenlabs", "cartesia", "speechify", "azure", "edge"],
    });
    expect(() => holder.engineStatus("kokoro")).toThrow(RangeError);
  });

  it("warns without the value and stays off on an invalid kokoro address", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const value of ["not a url", "ftp://127.0.0.1:8880"]) {
        warn.mockClear();
        const configs: TtsConfig[] = [];
        createTtsHolder({
          createTts: (config) => {
            configs.push(config);
            return createTts(config);
          },
          resolveKey: keys({ KOKORO_TTS_BASE_URL: value }),
        });
        expect(warn).toHaveBeenCalledTimes(1);
        const message = String(warn.mock.calls[0]![0]);
        expect(message).toContain("KOKORO_TTS_BASE_URL");
        expect(message).not.toContain(value);
        expect(Object.hasOwn(configs[0]!.engines, "kokoro")).toBe(false);
        expect(configs[0]!.engines.cascade).toEqual({
          order: ["elevenlabs", "cartesia", "speechify", "azure", "edge"],
        });
      }
    } finally {
      warn.mockRestore();
    }
  });

  it("orders openai before kokoro when both are set", () => {
    const configs: TtsConfig[] = [];
    createTtsHolder({
      createTts: (config) => {
        configs.push(config);
        return createTts(config);
      },
      resolveKey: keys({
        OPENAI_TTS_BASE_URL: "http://127.0.0.1:8890",
        KOKORO_TTS_BASE_URL: "http://127.0.0.1:8880",
      }),
      catalog: liveCatalog([EN_MALE, PL_FEMALE]),
    });

    expect(configs[0]!.engines.openai).toMatchObject({ baseUrl: "http://127.0.0.1:8890" });
    expect(configs[0]!.engines.kokoro).toEqual({ baseUrl: "http://127.0.0.1:8880", firstByteMs: 30000, retries: 0 });
    expect(configs[0]!.engines.cascade).toEqual({
      order: ["openai", "kokoro", "elevenlabs", "cartesia", "speechify", "azure", "edge"],
    });
  });
});
