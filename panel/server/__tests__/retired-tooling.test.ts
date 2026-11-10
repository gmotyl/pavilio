import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * The provider-era workflow (per-project AI-provider configs, `npm run
 * create-project`, provider setup menus) is retired. This pins that its docs,
 * scripts, templates and package.json entries stay gone, and that every
 * remaining script entry points at a file that actually exists.
 */

const REPO_ROOT = resolve(__dirname, "../../..");

const RETIRED_PATHS = [
  "SETUP.md",
  "ARCHITECTURE.md",
  "docs/PROJECT-SETUP-GUIDE.md",
  "docs/PROVIDER-SETUP.md",
  "docs/PROVIDERS.md",
  "docs/provider-selection.md",
  "docs/switching-providers.md",
  "docs/workflow.md",
  "docs/WORKFLOW-EXAMPLE.md",
  "agents",
  "scripts/create-project.sh",
  "scripts/register-project.sh",
  "scripts/concatenate-markdown.sh",
  "scripts/setup:all",
  "scripts/setup:kilocode-cli",
  "scripts/setup:copilot",
  "scripts/setup:qwen",
  "scripts/setup:gemini",
  "scripts/setup:todoist",
  "scripts/setup:jira",
  "scripts/setup:github",
  "scripts/setup:azure-devops",
  "templates",
  "examples",
];

const RETIRED_SCRIPTS = [
  "create-project",
  "register-project",
  "setup:all",
  "setup:kilocode-cli",
  "setup:copilot",
  "setup:qwen",
  "setup:gemini",
  "setup:todoist",
  "setup:github",
  "setup:jira",
  "setup:azure-devops",
  "install-skills",
];

function rootScripts(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  return pkg.scripts ?? {};
}

describe("retired provider-era tooling", () => {
  it("provider-era docs, scripts, templates and examples are gone", () => {
    const present = RETIRED_PATHS.filter((path) => existsSync(join(REPO_ROOT, path)));
    expect(present, "retired paths still in the repo").toEqual([]);
  });

  it("package.json defines no retired script and every script target exists", () => {
    const scripts = rootScripts();
    const retired = RETIRED_SCRIPTS.filter((name) => name in scripts);
    expect(retired, "retired package.json scripts still defined").toEqual([]);

    const dangling: string[] = [];
    for (const [name, command] of Object.entries(scripts)) {
      const m = command.match(/^(?:\.\/|bash\s+)((?:scripts|skills)\/\S+)/);
      if (!m) continue;
      if (!existsSync(join(REPO_ROOT, m[1]))) dangling.push(`${name} -> ${m[1]}`);
    }
    expect(dangling, "package.json scripts pointing at missing files").toEqual([]);
  });
});
