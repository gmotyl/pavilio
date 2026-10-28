import { describe, it, expect, vi } from "vitest";
import { createTts } from "anytts/server";
import type { TtsConfig } from "anytts";
import { createTtsHolder } from "../ttsHolder";
import type { KeyVar, KeySource } from "../secrets";

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
});
