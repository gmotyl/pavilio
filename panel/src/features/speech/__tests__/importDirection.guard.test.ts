import { readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The dependency between speech and terminal runs one way: `features/terminal`
 * may import `features/speech`, never the reverse. The component that knows
 * both sides lives in terminal and hands speech its ports.
 *
 * The walk covers every production file under `features/speech/` (anything in
 * `__tests__/` or named `*.test.*` is exempt) and reads every static import,
 * re-export, side-effect import and dynamic `import()`. `import type` counts:
 * a type-only import is still a dependency on terminal's module, and moving a
 * type across the boundary is part of the decoupling.
 *
 * KNOWN_OFFENDERS is a ratchet. It names the files allowed to import terminal
 * today; a file that stops needing the allowance must leave the list, so the
 * list can only shrink until it is deleted.
 */
const SPEECH = join(dirname(fileURLToPath(import.meta.url)), "..");
const TERMINAL = join(SPEECH, "..", "terminal");

/** Paths relative to `features/speech/`. */
const KNOWN_OFFENDERS: readonly string[] = [
  "SpeechHostProvider.tsx",
  "useSpeechHost.ts",
];

const SPECIFIER_PATTERNS = [
  // import x from "…", import { a } from "…", import type { T } from "…",
  // export { a } from "…", export * from "…"
  /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
  // import "…"
  /\bimport\s*['"]([^'"]+)['"]/g,
  // import("…")
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function specifiersOf(source: string): string[] {
  return SPECIFIER_PATTERNS.flatMap((pattern) =>
    [...source.matchAll(pattern)].map((match) => match[1] as string),
  );
}

function isUnderTerminal(resolved: string): boolean {
  const rel = relative(TERMINAL, resolved);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

/** The specifiers in `source` (a file at `file`) that resolve under `features/terminal/`. */
function terminalImports(file: string, source: string): string[] {
  return specifiersOf(source).filter(
    (specifier) =>
      specifier.startsWith(".") && isUnderTerminal(resolve(dirname(file), specifier)),
  );
}

function productionFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : productionFiles(path);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

function offenders(): Map<string, string[]> {
  const files = productionFiles(SPEECH);
  // A walk that matched nothing would make this a test that can only pass.
  expect(files.map((file) => relative(SPEECH, file))).toContain("SpeechHostProvider.tsx");

  const found = new Map<string, string[]>();
  for (const file of files) {
    const specifiers = terminalImports(file, readFileSync(file, "utf8"));
    if (specifiers.length > 0) {
      found.set(relative(SPEECH, file).split("\\").join("/"), specifiers);
    }
  }
  return found;
}

describe("speech → terminal import direction", () => {
  it("the detector sees every import form that reaches terminal", () => {
    const file = join(SPEECH, "nested", "fake.ts");
    const source = [
      'import { a } from "../../terminal/a";',
      'import type { B } from "../../terminal/b";',
      "import {\n  c,\n  d,\n} from '../../terminal/c';",
      'export { e } from "../../terminal/e";',
      'export * from "../../terminal";',
      'import "../../terminal/side-effect";',
      'const f = await import("../../terminal/f");',
      'import { g } from "../voices";',
      'import { h } from "../../terminalish/h";',
      'import { i } from "react";',
    ].join("\n");

    expect(terminalImports(file, source).sort()).toEqual(
      [
        "../../terminal",
        "../../terminal/a",
        "../../terminal/b",
        "../../terminal/c",
        "../../terminal/e",
        "../../terminal/f",
        "../../terminal/side-effect",
      ].sort(),
    );
  });

  it("no production speech file outside the allowlist imports features/terminal", () => {
    const unexpected = [...offenders()]
      .filter(([file]) => !KNOWN_OFFENDERS.includes(file))
      .flatMap(([file, specifiers]) => specifiers.map((specifier) => `${file} → ${specifier}`));

    expect(unexpected).toEqual([]);
  });

  it("every allowlisted file still needs the allowance", () => {
    const found = offenders();
    const stale = KNOWN_OFFENDERS.filter((file) => !found.has(file)).map(
      (file) => `${file} no longer imports terminal — remove it from the allowlist`,
    );

    expect(stale).toEqual([]);
  });
});
