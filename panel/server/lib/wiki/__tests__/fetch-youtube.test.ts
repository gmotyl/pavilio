import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { main } from "../cli";
import type { RunResult, Runner } from "../fetch-youtube";

const URL = "https://www.youtube.com/watch?v=abc123XYZ_-";

const VTT = `WEBVTT
Kind: captions
Language: en

00:00:01.000 --> 00:00:04.000
But what is a neural network?

00:00:31.000 --> 00:00:34.000
This is a three.
`;

type Info = {
  language?: string | null;
  subtitles?: Record<string, unknown[]>;
  automatic_captions?: Record<string, unknown[]>;
};

function info(extra: Info): string {
  return JSON.stringify({
    id: "abc123XYZ_-",
    title: "But what is a neural network?",
    channel: "3Blue1Brown",
    upload_date: "20171005",
    webpage_url: URL,
    language: "en",
    subtitles: {},
    automatic_captions: {},
    ...extra,
  });
}

type Call = { cmd: string; args: string[] };

/** A fake `uvx`: answers `--dump-json` with `dump`, writes the VTT next to `-o` on a download. */
function fakeRunner(dump: string, opts: { failFirst?: number; download?: boolean } = {}) {
  const calls: Call[] = [];
  let failures = opts.failFirst ?? 0;
  const run: Runner = async (cmd, args): Promise<RunResult> => {
    calls.push({ cmd, args });
    if (failures > 0) {
      failures--;
      return { code: 1, stdout: "", stderr: "ERROR: Unable to extract" };
    }
    if (args.includes("--dump-json")) return { code: 0, stdout: dump, stderr: "" };
    const out = args[args.indexOf("-o") + 1];
    const lang = args[args.indexOf("--sub-langs") + 1];
    if (opts.download !== false) writeFileSync(`${out.replace("%(id)s", "abc123XYZ_-")}.${lang}.vtt`, VTT);
    return { code: 0, stdout: "", stderr: "" };
  };
  return { run, calls };
}

let root = "";
let project = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wiki-yt-"));
  project = join(root, "projects", "demo");
  mkdirSync(project, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function cli(run: Runner) {
  let out = "";
  let err = "";
  const code = await main(["fetch-youtube", "demo", URL], {
    stdout: { write: (s: string) => (out += s) },
    stderr: { write: (s: string) => (err += s) },
    cwd: root,
    env: {},
    workspaceRoot: root,
    run,
  });
  return { code, json: JSON.parse(out), stderr: err };
}

const download = (calls: Call[]) => calls.find((c) => c.args.includes("--skip-download"))!;
const subFlag = (call: Call) => call.args.find((a) => a === "--write-subs" || a === "--write-auto-subs");
const subLangs = (call: Call) => call.args[call.args.indexOf("--sub-langs") + 1];
const rawDir = () => join(project, "wiki", "raw");

describe("fetch-youtube", () => {
  it("prefers manual subtitles in the video language", async () => {
    const { run, calls } = fakeRunner(
      info({ language: "en", subtitles: { en: [{}], de: [{}] }, automatic_captions: { "en-orig": [{}], en: [{}] } }),
    );
    const res = await cli(run);
    expect(res.code).toBe(0);
    expect(res.json).toEqual({ raw: "raw/youtube-abc123XYZ_-.md", title: "But what is a neural network?", track: "en" });
    expect(subFlag(download(calls))).toBe("--write-subs");
    expect(subLangs(download(calls))).toBe("en");
    expect(calls[0]).toEqual({ cmd: "uvx", args: ["--with", "curl_cffi", "yt-dlp", "--dump-json", "--no-playlist", "--", URL] });
  });

  it("ignores the playlist of a watch URL", async () => {
    const { run, calls } = fakeRunner(info({ subtitles: { en: [{}] } }));
    expect((await cli(run)).code).toBe(0);
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call.args).toContain("--no-playlist");
  });

  it("falls back to auto orig then en", async () => {
    const orig = fakeRunner(info({ language: "pl", subtitles: { en: [{}] }, automatic_captions: { "pl-orig": [{}], pl: [{}] } }));
    expect((await cli(orig.run)).json.track).toBe("pl-orig");
    expect(subFlag(download(orig.calls))).toBe("--write-auto-subs");
    expect(subLangs(download(orig.calls))).toBe("pl-orig");

    const en = fakeRunner(info({ language: "pl", subtitles: { en: [{}] }, automatic_captions: { de: [{}] } }));
    expect((await cli(en.run)).json.track).toBe("en");
    expect(subFlag(download(en.calls))).toBe("--write-subs");
    expect(subLangs(download(en.calls))).toBe("en");
  });

  it("requests exact sub-langs only", async () => {
    const { run, calls } = fakeRunner(
      info({ language: "en", automatic_captions: { "en-orig": [{}], en: [{}], "en-de": [{}], fr: [{}] } }),
    );
    expect((await cli(run)).code).toBe(0);
    const call = download(calls);
    expect(subLangs(call)).toBe("en-orig");
    for (const arg of call.args) expect(arg).not.toMatch(/\.\*|,/);
    expect(call.args).toEqual(expect.arrayContaining(["--skip-download", "--sub-format", "vtt"]));
  });

  it("writes frontmatter with title channel date url", async () => {
    const { run } = fakeRunner(info({ subtitles: { en: [{}] } }));
    expect((await cli(run)).code).toBe(0);
    const text = readFileSync(join(rawDir(), "youtube-abc123XYZ_-.md"), "utf8");
    expect(text).toMatch(/^---\n/);
    expect(text).toContain('title: "But what is a neural network?"');
    expect(text).toContain('channel: "3Blue1Brown"');
    expect(text).toContain("upload_date: 2017-10-05");
    expect(text).toContain(`source_url: "${URL}"`);
    expect(text).toContain("origin: youtube");
    expect(text).toContain("[00:01] But what is a neural network?");
    expect(text).toContain("[00:31] This is a three.");
  });

  it("missing uvx exits 2 with hint", async () => {
    const run: Runner = async () => ({ code: 127, stdout: "", stderr: "spawn uvx ENOENT" });
    const res = await cli(run);
    expect(res.code).toBe(2);
    expect(res.json.ask).toBe(true);
    expect(res.json.reason).toMatch(/uv/);
    expect(res.json.reason).toMatch(/install/i);
    expect(existsSync(rawDir())).toBe(false);
  });

  it("retries once with yt-dlp@latest", async () => {
    const once = fakeRunner(info({ subtitles: { en: [{}] } }), { failFirst: 1 });
    expect((await cli(once.run)).code).toBe(0);
    expect(once.calls[1].args).toContain("yt-dlp@latest");
    expect(download(once.calls).args).toContain("yt-dlp@latest");

    rmSync(rawDir(), { recursive: true, force: true });
    const twice = fakeRunner(info({ subtitles: { en: [{}] } }), { failFirst: 2 });
    const res = await cli(twice.run);
    expect(res.code).toBe(1);
    expect(twice.calls).toHaveLength(2);
    expect(res.json.error).toMatch(/yt-dlp/);
    expect(existsSync(rawDir()) ? readdirSync(rawDir()).filter((f) => f.endsWith(".md")) : []).toEqual([]);
  });

  it("no usable track exits 1 listing languages", async () => {
    const { run, calls } = fakeRunner(
      info({
        language: "pl",
        subtitles: { de: [{}] },
        automatic_captions: { "fr-orig": [{}], "en-fr": [{}], ja: [{}], "zh-Hant": [{}], fr: [{}] },
      }),
    );
    const res = await cli(run);
    expect(res.code).toBe(1);
    expect(res.json.error).toMatch(/manual: de;/);
    expect(res.json.error).toMatch(/automatic: fr-orig, en-fr$/);
    expect(res.json.error).not.toMatch(/\bja\b|zh-Hant/);
    expect(calls.some((c) => c.args.includes("--skip-download"))).toBe(false);
  });
});
