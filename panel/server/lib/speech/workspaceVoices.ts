import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The workspace voice copy: every custom OmniVoice voice added from Settings is also kept as
 * `<workspaceRoot>/.pavilio/voices/<name>/sample.wav` (the server's converted wav) plus
 * `voice.json` (the voice record, `ref_text` included), next to `.pavilio/preferences.json`.
 * It travels with the workspace, so `install:speech` can clone the voice onto a fresh server.
 */

const SAMPLE_FILE = "sample.wav";
const RECORD_FILE = "voice.json";

export interface WorkspaceVoice {
  record: unknown;
  sample: Buffer;
}

export const workspaceVoicesDir = (workspaceRoot: string): string => join(workspaceRoot, ".pavilio", "voices");

/**
 * Whether a name can be a single directory under the voices dir: letters, digits, `-`, `_`, `.`,
 * starting with a letter or digit, and no `..` — so it never escapes the dir or hides a file.
 * Looser than omnivoice-server's own name rule, so an older server's voice names still pass.
 */
export function isSafeVoiceName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) && !name.includes("..");
}

function voiceDir(workspaceRoot: string, name: string): string {
  if (!isSafeVoiceName(name)) throw new RangeError(`not a safe voice name: ${JSON.stringify(name)}`);
  return join(workspaceVoicesDir(workspaceRoot), name);
}

/** Writes each file through a temp name, so a crash never leaves a half-written one. */
async function writeAtomic(path: string, data: string | Buffer): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, data);
  await rename(temp, path);
}

/** Writes (or replaces) a voice copy. Throws RangeError for an unsafe name. */
export async function writeWorkspaceVoice(workspaceRoot: string, name: string, voice: WorkspaceVoice): Promise<void> {
  const dir = voiceDir(workspaceRoot, name);
  await mkdir(dir, { recursive: true });
  await writeAtomic(join(dir, SAMPLE_FILE), voice.sample);
  await writeAtomic(join(dir, RECORD_FILE), `${JSON.stringify(voice.record, null, 2)}\n`);
}

/** The voice copy, or undefined when there is none. Throws RangeError for an unsafe name. */
export async function readWorkspaceVoice(workspaceRoot: string, name: string): Promise<WorkspaceVoice | undefined> {
  const dir = voiceDir(workspaceRoot, name);
  try {
    const [record, sample] = await Promise.all([readFile(join(dir, RECORD_FILE), "utf8"), readFile(join(dir, SAMPLE_FILE))]);
    return { record: JSON.parse(record) as unknown, sample };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Removes a voice copy; a missing one is not an error. Throws RangeError for an unsafe name. */
export async function removeWorkspaceVoice(workspaceRoot: string, name: string): Promise<void> {
  await rm(voiceDir(workspaceRoot, name), { recursive: true, force: true });
}

/** The names of the voice copies: safe-named dirs that hold a `voice.json`, sorted. */
export async function listWorkspaceVoices(workspaceRoot: string): Promise<string[]> {
  const dir = workspaceVoicesDir(workspaceRoot);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isSafeVoiceName(entry.name)) continue;
    try {
      if ((await stat(join(dir, entry.name, RECORD_FILE))).isFile()) names.push(entry.name);
    } catch {
      // A dir without a record is not a voice copy (a half-written or foreign one).
    }
  }
  return names.sort();
}
