import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const MODULE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const DEFAULT_ROOT = "/srv/git/prv/projects";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("fs");
  vi.resetModules();
});

async function loadPanelConfig() {
  vi.resetModules();
  return import("../../../panel.config");
}

describe("panel workspace root", () => {
  it("uses matching default candidate for workspace root and projects directory without realpath normalization", async () => {
    vi.stubEnv("PAVILIO_WORKSPACE_ROOT", undefined);
    vi.doMock("fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("fs")>();
      const moduleRootIdentity = actual.realpathSync(MODULE_ROOT);
      return {
        ...actual,
        realpathSync: (path: string) =>
          path === DEFAULT_ROOT ? moduleRootIdentity : actual.realpathSync(path as never),
      };
    });
    const config = await loadPanelConfig();

    expect(config.WORKSPACE_ROOT).toBe(DEFAULT_ROOT);
    expect(config.default.projectsDir).toBe(join(DEFAULT_ROOT, "projects"));
    expect(dirname(config.default.preferencesPath)).toBe(join(DEFAULT_ROOT, ".pavilio", "preferences"));
  });

  it("uses valid explicit override for workspace root and projects directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "workspace-root-"));
    try {
      const override = join(dir, "same-repository");
      symlinkSync(MODULE_ROOT, override);
      vi.stubEnv("PAVILIO_WORKSPACE_ROOT", override);

      const config = await loadPanelConfig();
      expect(config.WORKSPACE_ROOT).toBe(override);
      expect(config.default.projectsDir).toBe(join(override, "projects"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ["relative", "relative/workspace", "absolute"],
    ["inaccessible", join(tmpdir(), "missing-workspace-root"), "inaccessible"],
    ["different repository", tmpdir(), "same repository"],
  ])("rejects %s override", async (_label, override, message) => {
    vi.stubEnv("PAVILIO_WORKSPACE_ROOT", override);
    await expect(loadPanelConfig()).rejects.toThrow(`PAVILIO_WORKSPACE_ROOT`);
    await expect(loadPanelConfig()).rejects.toThrow(message);
  });

  it.each(["unavailable", "mismatched"])(
    "falls back to module root when default candidate is %s",
    async (candidateStatus) => {
      vi.stubEnv("PAVILIO_WORKSPACE_ROOT", undefined);
      vi.doMock("fs", async (importOriginal) => {
        const actual = await importOriginal<typeof import("fs")>();
        return {
          ...actual,
          realpathSync: (path: string) => {
            if (path === DEFAULT_ROOT) {
              if (candidateStatus === "unavailable") throw new Error("candidate unavailable");
              return join(tmpdir(), "another-repository");
            }
            return actual.realpathSync(path as never);
          },
        };
      });

      const config = await loadPanelConfig();
      expect(config.WORKSPACE_ROOT).toBe(MODULE_ROOT);
      expect(config.default.projectsDir).toBe(join(MODULE_ROOT, "projects"));
    },
  );
});
