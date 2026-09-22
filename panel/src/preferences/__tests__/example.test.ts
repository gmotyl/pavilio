import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ALL_PREFERENCES } from "../declarations";

/**
 * The example preferences document is the only thing this public repository
 * ships in `.pavilio/`: the real `preferences.json` is gitignored, because it
 * holds pane geometry, project names and absolute repo paths from whichever
 * workspace last wrote it.
 *
 * That makes the example the sole documentation of the file's shape, and
 * nothing else reads it — so a deleted, malformed or drifted example would go
 * unnoticed until someone tried to follow it. Hence this test reads the
 * SHIPPED file off disk rather than an inline fixture: a missing file is a
 * red, not a silent skip.
 *
 * It checks the format marker the server's loader keys on (`version: 1`), and
 * then that every key the example teaches actually exists in the registry,
 * with the scope suffix `storageKey` would produce and a value its own codec
 * accepts. An example that names a key nobody declares is worse than none.
 */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const EXAMPLE_PATH = join(REPO_ROOT, ".pavilio", "preferences.example.json");

/** The inverse of the store's `toRaw`: the text a stored value parses from. */
function toRaw(stored: unknown): string {
  return typeof stored === "string" ? stored : JSON.stringify(stored);
}

describe("the shipped example preferences file", () => {
  it("is valid and versioned", () => {
    expect(existsSync(EXAMPLE_PATH), `missing shipped example at ${EXAMPLE_PATH}`).toBe(true);

    const text = readFileSync(EXAMPLE_PATH, "utf8");
    const doc: unknown = JSON.parse(text);
    expect(doc).toBeTypeOf("object");
    expect(doc).not.toBeNull();
    expect(Array.isArray(doc)).toBe(false);

    const record = doc as Record<string, unknown>;
    expect(record.version).toBe(1);

    const entries = Object.entries(record).filter(([key]) => key !== "version");
    // An example that demonstrates nothing would pass every check below.
    expect(entries.length).toBeGreaterThanOrEqual(4);

    const scopes = new Set<string>();
    for (const [storageKey, value] of entries) {
      const at = storageKey.indexOf("@");
      const key = at === -1 ? storageKey : storageKey.slice(0, at);
      const scopeArg = at === -1 ? undefined : storageKey.slice(at + 1);

      const def = ALL_PREFERENCES.find((candidate) => candidate.key === key);
      expect(def, `no declaration for "${key}" (from "${storageKey}")`).toBeDefined();
      if (!def) continue;

      // Only a portable declaration belongs in the workspace file at all.
      expect(def.portable, `"${key}" is not portable`).toBe(true);

      if (def.scope === "global") {
        expect(scopeArg, `global "${key}" must carry no scope suffix`).toBeUndefined();
      } else {
        expect(scopeArg, `${def.scope}-scoped "${key}" needs a scope suffix`).toBeTruthy();
      }
      if (def.scope === "repo") {
        // Repo scopes are normalized (a `~` is expanded), so the example has
        // to show the absolute form or it teaches a key that never occurs.
        expect(scopeArg?.startsWith("/"), `repo scope "${scopeArg ?? ""}" must be absolute`).toBe(
          true,
        );
      }
      scopes.add(def.scope);

      // The value has to survive the codec the panel would read it with.
      expect(() => def.codec.parse(toRaw(value)), `"${storageKey}" is not a valid value`).not.toThrow();
    }

    // The shapes the example exists to demonstrate.
    expect([...scopes].sort()).toEqual(["global", "project", "repo"]);
  });
});
