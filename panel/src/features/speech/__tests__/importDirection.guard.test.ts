import { readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The dependency between speech and terminal runs one way: `features/terminal`
 * may import `features/speech`, never the reverse. The component that knows
 * both sides lives in terminal and hands speech its ports.
 *
 * The walk covers every production file under `features/speech/` (anything in
 * `__tests__/` or named `*.test.*` is exempt) and reads its imports from the
 * TypeScript syntax tree: static imports, re-exports, side-effect imports,
 * dynamic `import()` with a string or template literal (a template's static
 * prefix is what gets resolved), `require()`, `import x = require()` and type
 * positions such as `typeof import("…")`. A specifier is taken at the value it
 * evaluates to, so escapes are resolved, and text that only looks like an
 * import (inside a string, a comment or a regex literal) is not one. `import
 * type` counts: a type-only import is still a dependency on terminal's module,
 * and moving a type across the boundary is part of the decoupling. Specifiers
 * computed at runtime (a variable passed to `import()`) are out of reach of a
 * source scan and are not covered.
 */
const SPEECH = join(dirname(fileURLToPath(import.meta.url)), "..");
const TERMINAL = join(SPEECH, "..", "terminal");

/** The string a module-specifier node evaluates to, or a template's static prefix. */
function specifierText(node: ts.Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text;
  return undefined;
}

/** Every module specifier `source` (a file at `file`) depends on, read from its syntax tree. */
function specifiersOf(file: string, source: string): string[] {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const found: string[] = [];
  const add = (node: ts.Node | undefined) => {
    const text = specifierText(node);
    if (text !== undefined) found.push(text);
  };

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node.moduleReference.expression);
    } else if (ts.isCallExpression(node)) {
      const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isImport || isRequire) add(node.arguments[0]);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

function isUnderTerminal(resolved: string): boolean {
  const rel = relative(TERMINAL, resolved);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

/** The specifiers in `source` (a file at `file`) that resolve under `features/terminal/`. */
function terminalImports(file: string, source: string): string[] {
  return specifiersOf(file, source).filter(
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
      "const j = await import(`../../terminal/j`);",
      "const k = await import(`../../terminal/${name}`);",
      'const l = require("../../terminal/l");',
      "import m = require('../../terminal/m');",
      'type N = typeof import("../../terminal/n");',
      'type O = import("../../terminal/o").O;',
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
        "../../terminal/j",
        "../../terminal/",
        "../../terminal/l",
        "../../terminal/m",
        "../../terminal/n",
        "../../terminal/o",
        "../../terminal/side-effect",
      ].sort(),
    );
  });

  it("comments inside an import do not hide it, and string contents are not comments", () => {
    const file = join(SPEECH, "nested", "fake.ts");
    const source = [
      'import /* "note" */ { x } from "../../terminal/x";',
      "import {\n  y, // it's needed\n  z,\n} from '../../terminal/y';",
      'const url = "https://x"; import { w } from "../../terminal/w";',
      "const glob = '/* not a comment'; import { v } from '../../terminal/v'; const end = '*/';",
      'const t = `https://${host}/*`; import { u } from "../../terminal/u";',
    ].join("\n");

    expect(terminalImports(file, source).sort()).toEqual(
      [
        "../../terminal/u",
        "../../terminal/v",
        "../../terminal/w",
        "../../terminal/x",
        "../../terminal/y",
      ].sort(),
    );
  });

  it("regex literals, string contents and escaped separators are read as the language reads them", () => {
    const file = join(SPEECH, "nested", "fake.ts");
    const source = [
      'const re = /\\/\\//; import { r } from "../../terminal/r";',
      "const example = 'import X from \"../../terminal/not-an-import\"';",
      "const other = `export * from '../../terminal/not-either'`;",
      'import "..\\/..\\/terminal\\/s";',
    ].join("\n");

    expect(terminalImports(file, source).sort()).toEqual(
      ["../../terminal/r", "../../terminal/s"].sort(),
    );
  });

  it("no production speech file imports features/terminal", () => {
    const found = [...offenders()].flatMap(([file, specifiers]) =>
      specifiers.map((specifier) => `${file} → ${specifier}`),
    );

    expect(found).toEqual([]);
  });
});
