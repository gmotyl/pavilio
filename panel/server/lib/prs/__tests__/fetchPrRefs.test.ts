import { describe, expect, it } from "vitest";
import { fetchPrRefs } from "../fetchPrRefs.js";
import type { RunResult, Runner } from "../run.js";

const REPO = "/work/acme-web";
const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: "" });

interface Call {
  cmd: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

function fakeGit(opts: { shallow: boolean; mergeBaseAfterDeepens: number; n: number }): { run: Runner; calls: Call[] } {
  const calls: Call[] = [];
  let deepens = 0;
  const run: Runner = async (cmd, args, o) => {
    calls.push({ cmd, args, cwd: o.cwd, env: o.env });
    if (cmd !== "git") throw new Error(`unexpected ${cmd}`);
    if (args[0] === "fetch") {
      if (args.some((a) => a.startsWith("--deepen="))) deepens++;
      return ok("");
    }
    if (args.join(" ") === "rev-parse --is-shallow-repository") return ok(`${opts.shallow}\n`);
    if (args[0] === "rev-parse" && args.includes(`refs/pavilio/pr/${opts.n}^{commit}`)) return ok("a".repeat(40) + "\n");
    if (args[0] === "rev-parse" && args.includes(`refs/pavilio/pr-base/${opts.n}^{commit}`)) return ok("b".repeat(40) + "\n");
    if (args[0] === "merge-base") {
      return deepens >= opts.mergeBaseAfterDeepens ? ok("c".repeat(40) + "\n") : { code: 1, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
  return { run, calls };
}

const fetches = (calls: Call[]) => calls.filter((c) => c.args[0] === "fetch");

describe("fetchPrRefs", () => {
  it("fetchPrRefs fetches a merge-request head into pavilio refs", async () => {
    const { run, calls } = fakeGit({ shallow: false, mergeBaseAfterDeepens: 0, n: 7 });
    const shas = await fetchPrRefs(run, REPO, { n: 7, headRefspecSource: "refs/merge-requests/7/head", base: "develop" });
    expect(shas).toEqual({ head: "a".repeat(40), base: "b".repeat(40) });

    const [fetch, ...rest] = fetches(calls);
    expect(rest).toHaveLength(0);
    expect(fetch.cwd).toBe(REPO);
    expect(fetch.env).toMatchObject({ GIT_TERMINAL_PROMPT: "0" });
    expect(fetch.args).toEqual([
      "fetch",
      "--no-tags",
      "--no-write-fetch-head",
      "--recurse-submodules=no",
      "--refmap=",
      "origin",
      "+refs/merge-requests/7/head:refs/pavilio/pr/7",
      "+refs/heads/develop:refs/pavilio/pr-base/7",
    ]);
    // Not shallow: no merge-base probing at all.
    expect(calls.some((c) => c.args[0] === "merge-base")).toBe(false);
  });

  it("fetchPrRefs deepens a shallow clone at most five rounds", async () => {
    const { run, calls } = fakeGit({ shallow: true, mergeBaseAfterDeepens: Number.POSITIVE_INFINITY, n: 7 });
    const shas = await fetchPrRefs(run, REPO, { n: 7, headRefspecSource: "refs/merge-requests/7/head", base: "main" });
    expect(shas).toEqual({ head: "a".repeat(40), base: "b".repeat(40) });

    const deepen = fetches(calls).filter((c) => c.args.some((a) => a.startsWith("--deepen=")));
    expect(deepen).toHaveLength(5);
    for (const c of deepen) {
      expect(c.args).toContain("--deepen=200");
      expect(c.args).toEqual(
        expect.arrayContaining(["+refs/merge-requests/7/head:refs/pavilio/pr/7", "+refs/heads/main:refs/pavilio/pr-base/7"]),
      );
    }

    // Stops as soon as the merge base shows up.
    const early = fakeGit({ shallow: true, mergeBaseAfterDeepens: 2, n: 7 });
    await fetchPrRefs(early.run, REPO, { n: 7, headRefspecSource: "refs/merge-requests/7/head", base: "main" });
    expect(fetches(early.calls).filter((c) => c.args.some((a) => a.startsWith("--deepen=")))).toHaveLength(2);
  });
});
