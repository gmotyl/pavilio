import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The synthesis cache is keyed on voice + text, so every module that
 * synthesizes a unit or asks whether one is cached has to resolve the SAME
 * voice — the session's, through `voiceForSession`. A reader that still asks
 * for the bare default voice synthesizes audio nobody plays, or reports a
 * project-voiced unit as missing.
 *
 * `getStoredVoice` is therefore left to the two modules that mean the default
 * voice itself: `voices.ts`, which resolves through it, and `VoiceSelect`,
 * which edits it. The walk covers all of `src` (tests excluded), so a reader
 * added anywhere is caught the moment it names the default.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const ALLOWED = new Set(["features/speech/voices.ts", "features/speech/VoiceSelect.tsx"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(path);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

describe("voice readers", () => {
  it("getStoredVoice is called only by voices.ts and VoiceSelect", () => {
    const files = sourceFiles(SRC);
    // A walk that matched nothing would make this a test that can only pass.
    expect(files.map((file) => relative(SRC, file))).toContain("features/speech/voices.ts");

    const callers = files
      .filter((file) => readFileSync(file, "utf8").includes("getStoredVoice("))
      .map((file) => relative(SRC, file).split("\\").join("/"));

    expect(callers.filter((file) => !ALLOWED.has(file))).toEqual([]);
  });
});
