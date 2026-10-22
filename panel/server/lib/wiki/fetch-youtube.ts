import { execFile } from "child_process";
import { lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { ensureContainedDir } from "./contained-dir";
import { vttToMarkdown } from "./vtt";

/**
 * Fetch one YouTube transcript into `<projectDir>/wiki/raw/youtube-<id>.md`.
 *
 * yt-dlp runs through `uvx` (with `curl_cffi` for browser impersonation), so nothing but `uv` has
 * to be installed. `--dump-json` gives the video's language and its track lists; exactly one track
 * is then downloaded: manual subtitles in the video's language, else the automatic `<lang>-orig`
 * track, else `en` (manual, then automatic). `--sub-langs` always names one exact code — a loose
 * `en.*` pattern pulls every auto-translated track and gets HTTP 429. Both calls pass
 * `--no-playlist`, so a `watch?v=X&list=Y` URL fetches only video X.
 *
 * The runner is injectable so tests never touch the network.
 */

export type RunResult = { code: number; stdout: string; stderr: string };
export type Runner = (cmd: string, args: string[]) => Promise<RunResult>;

export type YoutubeReceipt = {
  /** Raw file path relative to the wiki dir, e.g. `raw/youtube-<id>.md`. */
  raw: string;
  title: string;
  /** The exact subtitle track used, e.g. `en` or `pl-orig`. */
  track: string;
};

export type FetchYoutubeOptions = {
  run?: Runner;
  now?: Date;
};

export const YTDLP_TIMEOUT_MS = 5 * 60 * 1000;
/** Exit code a shell reports for a missing command; the default runner maps ENOENT to it. */
const COMMAND_NOT_FOUND = 127;

export const UV_INSTALL_HINT =
  "uvx (from uv) is not on PATH — install uv: `curl -LsSf https://astral.sh/uv/install.sh | sh` " +
  "(or `brew install uv` / `pipx install uv`), then retry";

/** `uvx` is missing: the CLI exits 2 and asks the user to install uv. */
export class UvMissingError extends Error {}

export const defaultRunner: Runner = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: YTDLP_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      const error = err as (NodeJS.ErrnoException & { code?: string | number }) | null;
      if (error?.code === "ENOENT") return resolve({ code: COMMAND_NOT_FOUND, stdout: "", stderr: error.message });
      const code = !error ? 0 : typeof error.code === "number" ? error.code : 1;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });

type VideoInfo = {
  id?: string;
  title?: string;
  channel?: string;
  uploader?: string;
  upload_date?: string;
  webpage_url?: string;
  language?: string | null;
  subtitles?: Record<string, unknown>;
  automatic_captions?: Record<string, unknown>;
};

export type Track = { code: string; auto: boolean };

/** yt-dlp invoked through uvx; on the first failure switches to `yt-dlp@latest` for good. */
function ytdlp(run: Runner) {
  let spec = "yt-dlp";
  return async (args: string[]): Promise<string> => {
    for (;;) {
      const res = await run("uvx", ["--with", "curl_cffi", spec, ...args]);
      if (res.code === COMMAND_NOT_FOUND) throw new UvMissingError(UV_INSTALL_HINT);
      if (res.code === 0) return res.stdout;
      if (spec === "yt-dlp") {
        spec = "yt-dlp@latest";
        continue;
      }
      const detail = res.stderr.trim().split("\n").slice(-3).join(" ").trim();
      throw new Error(`yt-dlp failed (also with yt-dlp@latest): ${detail || `exit ${res.code}`}`);
    }
  };
}

/** First key equal to `lang`, else one of the same base language (`en` ↔ `en-US`); never a `-orig`. */
function sameLanguage(keys: string[], lang: string): string | undefined {
  const base = lang.split("-")[0];
  return (
    keys.find((k) => k === lang) ??
    keys.find((k) => k === base) ??
    keys.find((k) => k.startsWith(`${base}-`) && !k.endsWith("-orig"))
  );
}

/** Manual in the video language → automatic `<lang>-orig` → `en` (manual, then automatic). */
export function pickTrack(info: VideoInfo): Track | null {
  const manual = Object.keys(info.subtitles ?? {}).filter((k) => k !== "live_chat");
  const auto = Object.keys(info.automatic_captions ?? {});
  const lang = info.language || auto.find((k) => k.endsWith("-orig"))?.replace(/-orig$/, "") || null;
  if (lang) {
    const own = sameLanguage(manual, lang);
    if (own) return { code: own, auto: false };
    const orig = [`${lang}-orig`, `${lang.split("-")[0]}-orig`].find((k) => auto.includes(k));
    if (orig) return { code: orig, auto: true };
  }
  const en = sameLanguage(manual, "en");
  if (en) return { code: en, auto: false };
  if (auto.includes("en")) return { code: "en", auto: true };
  return null;
}

function safeId(info: VideoInfo, url: string): string {
  const id = (info.id ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  if (!id) throw new Error(`yt-dlp returned no video id for ${url}`);
  return id;
}

function uploadDate(raw: string | undefined): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(raw ?? "");
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Fetch `url`'s transcript and write the raw snapshot. */
export async function fetchYoutube(
  projectDir: string,
  url: string,
  options: FetchYoutubeOptions = {},
): Promise<YoutubeReceipt> {
  if (!/^https?:\/\//i.test(url)) throw new Error(`not a video URL: ${url}`);
  const run = ytdlp(options.run ?? defaultRunner);

  let info: VideoInfo;
  try {
    info = JSON.parse(await run(["--dump-json", "--no-playlist", "--", url])) as VideoInfo;
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error(`yt-dlp --dump-json returned no JSON for ${url}`);
    throw err;
  }
  const id = safeId(info, url);
  const track = pickTrack(info);
  if (!track) {
    // Automatic keys are ~150 auto-translations; only `-orig` and English ones are worth naming.
    const useful = (k: string) => k.endsWith("-orig") || k === "en" || k.startsWith("en-");
    const list = (keys: string[]) => keys.join(", ") || "none";
    throw new Error(
      `no usable subtitle track for ${url} (language ${info.language ?? "unknown"}); ` +
        `manual: ${list(Object.keys(info.subtitles ?? {}))}; ` +
        `automatic: ${list(Object.keys(info.automatic_captions ?? {}).filter(useful))}`,
    );
  }

  const tmp = mkdtempSync(join(tmpdir(), "wiki-yt-"));
  let vtt: string;
  try {
    await run([
      "--skip-download",
      "--no-playlist",
      track.auto ? "--write-auto-subs" : "--write-subs",
      "--sub-format",
      "vtt",
      "--sub-langs",
      track.code,
      "-o",
      join(tmp, "%(id)s"),
      "--",
      url,
    ]);
    const file = readdirSync(tmp).find((f) => f.endsWith(".vtt"));
    if (!file) throw new Error(`yt-dlp wrote no ${track.code} subtitle file for ${url}`);
    vtt = readFileSync(join(tmp, file), "utf8");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const body = vttToMarkdown(vtt);
  if (!body.trim()) throw new Error(`the ${track.code} subtitle track of ${url} is empty`);

  // Refuse a symlinked or escaping wiki/raw before writing.
  const rawDir = ensureContainedDir(projectDir, ["wiki", "raw"]);
  const name = `youtube-${id}.md`;
  const file = join(rawDir, name);
  if (lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error(`refusing a symlinked raw snapshot: ${file}`);
  }
  const title = info.title?.trim() || url;
  const channel = info.channel || info.uploader || null;
  const date = uploadDate(info.upload_date);
  const fetched = (options.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
  const header = [
    "---",
    `title: ${JSON.stringify(title)}`,
    ...(channel ? [`channel: ${JSON.stringify(channel)}`] : []),
    ...(date ? [`upload_date: ${date}`] : []),
    `source_url: ${JSON.stringify(info.webpage_url || url)}`,
    "origin: youtube",
    `track: ${JSON.stringify(`${track.code}${track.auto ? " (automatic)" : ""}`)}`,
    `fetched: ${fetched}`,
    "---",
    "",
    `# ${title}`,
    "",
    "",
  ].join("\n");
  writeFileSync(file, `${header}${body}\n`);
  return { raw: `raw/${name}`, title, track: track.code };
}
