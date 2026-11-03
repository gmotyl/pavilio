import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isSafeVoiceName,
  listWorkspaceVoices,
  readWorkspaceVoice,
  removeWorkspaceVoice,
  workspaceVoicesDir,
  writeWorkspaceVoice,
} from "../workspaceVoices";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "panel-workspace-voices-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const RECORD = { id: "my-voice", source: "custom", locale: "pl-PL", ref_text: "Dzień dobry." };
const SAMPLE = Buffer.from("RIFF....WAVEfmt ");

describe("workspaceVoices", () => {
  it("writes, reads, lists and removes a voice copy", async () => {
    await writeWorkspaceVoice(root, "my-voice", { record: RECORD, sample: SAMPLE });

    const dir = join(root, ".pavilio", "voices", "my-voice");
    expect(workspaceVoicesDir(root)).toBe(join(root, ".pavilio", "voices"));
    expect(readFileSync(join(dir, "sample.wav")).equals(SAMPLE)).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "voice.json"), "utf8"))).toEqual(RECORD);

    const read = await readWorkspaceVoice(root, "my-voice");
    expect(read?.record).toEqual(RECORD);
    expect(read?.sample.equals(SAMPLE)).toBe(true);
    expect(await listWorkspaceVoices(root)).toEqual(["my-voice"]);

    await removeWorkspaceVoice(root, "my-voice");
    expect(existsSync(dir)).toBe(false);
    expect(await readWorkspaceVoice(root, "my-voice")).toBeUndefined();
    expect(await listWorkspaceVoices(root)).toEqual([]);
  });

  it("lists nothing without a voices dir and skips entries that are not voice copies", async () => {
    expect(await listWorkspaceVoices(root)).toEqual([]);

    const dir = workspaceVoicesDir(root);
    mkdirSync(join(dir, "half-written"), { recursive: true });
    writeFileSync(join(dir, "stray.txt"), "x");
    await writeWorkspaceVoice(root, "ania", { record: { id: "ania" }, sample: SAMPLE });
    expect(await listWorkspaceVoices(root)).toEqual(["ania"]);
  });

  it("rejects path-escaping names", async () => {
    for (const name of ["", ".", "..", "../x", "a/b", "a\\b", ".hidden", "x..y", "a\0b"]) {
      expect(isSafeVoiceName(name), JSON.stringify(name)).toBe(false);
      await expect(writeWorkspaceVoice(root, name, { record: {}, sample: SAMPLE })).rejects.toThrow(RangeError);
      await expect(removeWorkspaceVoice(root, name)).rejects.toThrow(RangeError);
    }
    for (const name of ["my-voice", "comic-s13", "vb-female_child_veryhigh_normal_british"]) {
      expect(isSafeVoiceName(name), name).toBe(true);
    }
    expect(existsSync(join(root, ".pavilio"))).toBe(false);
  });
});
