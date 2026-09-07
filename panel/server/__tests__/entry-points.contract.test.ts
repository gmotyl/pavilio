import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

// From panel/server/__tests__ up one level reaches panel/server.
const SERVER_DIR = join(__dirname, "..");

const read = (relPath: string): string =>
  readFileSync(join(SERVER_DIR, relPath), "utf8");

/**
 * Every module specifier the source actually imports at runtime: static
 * `import`/`export ... from`, dynamic `import()`, and `require()`.
 *
 * Matching on the specifier rather than on the word "vite" anywhere in the
 * file means a renamed binding (`import { createServer as makeIt } from
 * "vite"`) is still caught, and a comment or a variable that merely says
 * "vite" is not a false positive.
 */
const importedModules = (source: string): string[] => {
  const specifiers: string[] = [];
  const patterns = [
    // import ... from "x"  /  export ... from "x"  /  import "x"
    /(?:^|\n)\s*(?:import|export)\s+(?:[\s\S]*?\sfrom\s+)?["']([^"']+)["']/g,
    // await import("x")
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    // require("x")
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
};

const importsVite = (source: string): boolean =>
  importedModules(source).some((m) => m === "vite" || m.startsWith("vite/"));

/** Every .ts file under panel/server, excluding tests, as paths relative to it. */
const serverSources = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "__tests__" || entry === "node_modules") continue;
        walk(full);
        continue;
      }
      if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;
      out.push(relative(SERVER_DIR, full));
    }
  };
  walk(SERVER_DIR);
  return out;
};

describe("panel server entry points", () => {
  it("the serving entry does not import vite", () => {
    const source = read("index.ts");
    expect(importedModules(source)).not.toContain("vite");
    expect(importsVite(source)).toBe(false);
  });

  it("the shared server assembly does not import vite", () => {
    const source = read("panel-server.ts");
    expect(importedModules(source)).not.toContain("vite");
    expect(importsVite(source)).toBe(false);
  });

  it("the dev entry is the only server file that creates a vite server", () => {
    const offenders = serverSources().filter((rel) => importsVite(read(rel)));
    expect(offenders).toEqual(["dev.ts"]);

    // And it really does create one, rather than merely importing the package.
    // Read the local name vite's createServer is bound to — it is aliased —
    // so the check survives a rename instead of grepping a literal.
    const dev = read("dev.ts");
    const binding = dev.match(
      /import\s*\{[^}]*\bcreateServer\b(?:\s+as\s+(\w+))?[^}]*\}\s*from\s*["']vite["']/,
    );
    expect(binding).not.toBeNull();
    const localName = binding?.[1] ?? "createServer";
    expect(dev).toMatch(new RegExp(`\\b${localName}\\s*\\(`));
  });
});
