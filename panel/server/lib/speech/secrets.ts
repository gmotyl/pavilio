import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { chmod, rename, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The secrets store: engine API keys in `<PANEL_AUTH_STATE_DIR ?? ~/.panel>/secrets.env`,
 * outside every repository. Values are never logged, and the file is never
 * merged into `process.env`, so terminals spawned by the panel do not inherit
 * the keys.
 */

export type KeyVar =
  | "ELEVENLABS_API_KEY"
  | "CARTESIA_API_KEY"
  | "SPEECHIFY_API_KEY"
  | "AZURE_SPEECH_KEY"
  | "AZURE_SPEECH_REGION";

export type KeySource = "env" | "file" | "none";

const KEY_VARS: ReadonlySet<string> = new Set<KeyVar>([
  "ELEVENLABS_API_KEY",
  "CARTESIA_API_KEY",
  "SPEECHIFY_API_KEY",
  "AZURE_SPEECH_KEY",
  "AZURE_SPEECH_REGION",
]);

function stateDir(): string {
  return process.env.PANEL_AUTH_STATE_DIR ?? join(homedir(), ".panel");
}

function secretsFile(): string {
  return join(stateDir(), "secrets.env");
}

const LINE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/** The file's lines as last read, keyed by the path they came from. */
let cache: { file: string; lines: string[] } | null = null;

function readLines(file: string): string[] {
  if (!existsSync(file)) return [];
  // A file edited on Windows has CRLF endings; a `\r` must not end up in a value.
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Read at first use and after every write; a changed state dir reads afresh. */
function fileLines(): string[] {
  const file = secretsFile();
  if (cache?.file !== file) cache = { file, lines: readLines(file) };
  return cache.lines;
}

function fileValue(name: KeyVar): string | undefined {
  for (const line of fileLines()) {
    const match = LINE.exec(line);
    if (match?.[1] === name) return match[2];
  }
  return undefined;
}

/** `process.env` first, then the secrets file; an empty value counts as absent. */
export function resolveKey(name: KeyVar): { value?: string; source: KeySource } {
  const env = process.env[name];
  if (env) return { value: env, source: "env" };
  const value = fileValue(name);
  if (value) return { value, source: "file" };
  return { source: "none" };
}

/**
 * Set (string) or remove (null) keys in the secrets file; an `undefined` entry
 * is skipped. Only the five key variables are accepted. Every other line,
 * comments included, stays as it was. Written to a temp file in the same
 * directory, then renamed over the old one, so a reader never sees half a file.
 */
export async function writeKeys(entries: Partial<Record<KeyVar, string | null>>): Promise<void> {
  const defined = Object.entries(entries).filter(([, value]) => value !== undefined);
  for (const [name, value] of defined) {
    // The type does not hold at runtime (a request body); the name may be echoed, the value never.
    if (!KEY_VARS.has(name)) throw new Error(`secrets: ${name} is not an engine key variable`);
    // A line break would split one key into two lines (or smuggle in another key).
    if (typeof value === "string" && /[\r\n]/.test(value)) {
      throw new Error(`secrets: the value for ${name} contains a line break`);
    }
  }

  const dir = stateDir();
  const file = secretsFile();
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const pending = new Map(defined);
  const lines: string[] = [];
  for (const line of readLines(file)) {
    const name = LINE.exec(line)?.[1];
    if (name === undefined || !pending.has(name)) {
      lines.push(line);
      continue;
    }
    const value = pending.get(name);
    pending.delete(name);
    if (typeof value === "string") lines.push(`${name}=${value}`);
  }
  for (const [name, value] of pending) {
    if (typeof value === "string") lines.push(`${name}=${value}`);
  }

  const temp = join(dir, `.secrets.env.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(temp, lines.length ? `${lines.join("\n")}\n` : "", { mode: 0o600, flag: "wx" });
    await chmod(temp, 0o600);
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  cache = { file, lines };
}
