import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { markArchivedInRegistry, markRestoredInRegistry } from "../registry";

let root = "";
let projectsDir = "";

const REGISTRY = `# Registry

## Projects Registry (Private)

| Project | Collection | Notes Path |
|---------|-----------|------------|
| alpha | alpha | \`projects/alpha/\` |
| beta | beta | \`projects/beta/\` |

## Project-Specific Rules

- keep me
`;

function registryFile() {
  return join(root, ".projects.local.md");
}

describe("registry sync", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "reg-"));
    projectsDir = join(root, "projects");
    mkdirSync(projectsDir, { recursive: true });
    writeFileSync(registryFile(), REGISTRY);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("moves the row to a new Archived Projects section", () => {
    markArchivedInRegistry(projectsDir, "alpha");
    const out = readFileSync(registryFile(), "utf8");
    expect(out).not.toMatch(/\| alpha \| alpha \|/);
    expect(out).toContain("## Archived Projects");
    expect(out).toContain("| alpha | `projects/archived/alpha/` |");
    expect(out).toContain("| beta | beta |");
    expect(out).toContain("keep me");
  });

  it("appends to an existing Archived section without duplicating", () => {
    markArchivedInRegistry(projectsDir, "alpha");
    markArchivedInRegistry(projectsDir, "beta");
    markArchivedInRegistry(projectsDir, "beta");
    const out = readFileSync(registryFile(), "utf8");
    expect(out.match(/\| beta \| `projects\/archived\/beta\/` \|/g)?.length).toBe(1);
    expect(out).toContain("| alpha | `projects/archived/alpha/` |");
  });

  it("restore moves the row back to the active table with matching columns", () => {
    markArchivedInRegistry(projectsDir, "alpha");
    markRestoredInRegistry(projectsDir, "alpha");
    const out = readFileSync(registryFile(), "utf8");
    expect(out).not.toContain("`projects/archived/alpha/`");
    expect(out).toContain("| alpha | alpha | `projects/alpha/` |");
  });

  it("is a no-op when the registry file does not exist", () => {
    rmSync(registryFile());
    expect(() => markArchivedInRegistry(projectsDir, "alpha")).not.toThrow();
    expect(existsSync(registryFile())).toBe(false);
  });

  it("archiving a project not in the registry still records it as archived", () => {
    markArchivedInRegistry(projectsDir, "gamma");
    const out = readFileSync(registryFile(), "utf8");
    expect(out).toContain("| gamma | `projects/archived/gamma/` |");
  });
});
