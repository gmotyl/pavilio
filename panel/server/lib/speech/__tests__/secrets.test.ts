import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KEY_VARS = [
  "ELEVENLABS_API_KEY",
  "CARTESIA_API_KEY",
  "SPEECHIFY_API_KEY",
  "AZURE_SPEECH_KEY",
  "AZURE_SPEECH_REGION",
] as const;

// The state dir is a not-yet-existing child of a temp root, so the store has
// to create it (and with which mode is part of the contract).
let root: string;
let dir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "panel-secrets-"));
  dir = join(root, "state");
  vi.stubEnv("PANEL_AUTH_STATE_DIR", dir);
  for (const name of KEY_VARS) vi.stubEnv(name, undefined);
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

const secretsFile = () => join(dir, "secrets.env");

describe("secrets store", () => {
  it("writes secrets.env with mode 0600 atomically", async () => {
    const { resolveKey, writeKeys } = await import("../secrets");
    await writeKeys({ ELEVENLABS_API_KEY: "el-1" });

    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(secretsFile()).mode & 0o777).toBe(0o600);
    expect(readFileSync(secretsFile(), "utf8")).toContain("ELEVENLABS_API_KEY=el-1");
    expect(resolveKey("ELEVENLABS_API_KEY")).toEqual({ value: "el-1", source: "file" });

    // A rename swaps in a new inode; an in-place rewrite would keep the old one.
    const before = statSync(secretsFile()).ino;
    await writeKeys({ CARTESIA_API_KEY: "ca-1" });
    expect(statSync(secretsFile()).ino).not.toBe(before);
    expect(statSync(secretsFile()).mode & 0o777).toBe(0o600);
    // No temp file is left beside it.
    expect(readdirSync(dir)).toEqual(["secrets.env"]);
  });

  it("the environment wins over the file", async () => {
    const { resolveKey, writeKeys } = await import("../secrets");
    await writeKeys({ ELEVENLABS_API_KEY: "from-file", CARTESIA_API_KEY: "ca-file" });
    vi.stubEnv("ELEVENLABS_API_KEY", "from-env");

    expect(resolveKey("ELEVENLABS_API_KEY")).toEqual({ value: "from-env", source: "env" });
    expect(resolveKey("CARTESIA_API_KEY")).toEqual({ value: "ca-file", source: "file" });
    expect(resolveKey("SPEECHIFY_API_KEY")).toEqual({ source: "none" });
  });

  it("removing a key keeps the others", async () => {
    // A file written by hand earlier, with a comment the store must not drop.
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(
      secretsFile(),
      "# engine keys\nELEVENLABS_API_KEY=el-1\nAZURE_SPEECH_KEY=az-1\nAZURE_SPEECH_REGION=westeurope\n",
      { mode: 0o600 },
    );
    const { resolveKey, writeKeys } = await import("../secrets");
    await writeKeys({ AZURE_SPEECH_KEY: null });

    const lines = readFileSync(secretsFile(), "utf8").split("\n");
    expect(lines).not.toContain("AZURE_SPEECH_KEY=az-1");
    expect(lines).toEqual(
      expect.arrayContaining(["# engine keys", "ELEVENLABS_API_KEY=el-1", "AZURE_SPEECH_REGION=westeurope"]),
    );
    expect(resolveKey("AZURE_SPEECH_KEY")).toEqual({ source: "none" });
    expect(resolveKey("AZURE_SPEECH_REGION")).toEqual({ value: "westeurope", source: "file" });
  });

  it("never touches process.env", async () => {
    const before = { ...process.env };
    const { resolveKey, writeKeys } = await import("../secrets");
    await writeKeys({ ELEVENLABS_API_KEY: "el-1", SPEECHIFY_API_KEY: "sp-1" });
    resolveKey("ELEVENLABS_API_KEY");
    await writeKeys({ ELEVENLABS_API_KEY: null });

    expect(process.env).toEqual(before);
    expect(process.env.SPEECHIFY_API_KEY).toBeUndefined();
  });
});
