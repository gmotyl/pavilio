import { act, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { jsonResponse, stubFetch, type FetchHandler } from "../../../test-utils";
import ReposTab from "../ReposTab";

export const MAIN = "/root/pavilio";
export const FEAT = "/root/pavilio-feat";
export const MISSING = "/root/notes";
export const SITE = "/root/site";

export const REPOS = [
  { name: "pavilio", path: MAIN, present: true },
  { name: "notes", path: MISSING, present: false },
  { name: "site", path: SITE, present: true },
];

export const TS_SOURCE = [
  'import x from "y";',
  "export function alpha() {",
  "  const inner = 1;",
  "}",
  "export interface Beta { a: string }",
  "type Gamma = string;",
  "export const DELTA = 1;",
  "class Epsilon {}",
  "export enum Zeta { A }",
  "export default async function omega() {}",
].join("\n");

export const A_CONTENT = Array.from({ length: 20 }, (_, i) => (i === 14 ? "const area = width * height;" : `line ${i + 1}`)).join("\n");
export const A_DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -14,3 +14,3 @@",
  " line 14",
  "-const area = w * h;",
  "+const area = width * height;",
  " line 16",
].join("\n");

const TREES: Record<string, { path: string; status: string | null; add?: number; del?: number }[]> = {
  [MAIN]: [
    { path: "README.md", status: null },
    { path: "src/a.ts", status: "M", add: 1, del: 1 },
    { path: "src/b.ts", status: null },
  ],
  [FEAT]: [{ path: "src/feat.ts", status: "?" }],
  [SITE]: [{ path: "index.html", status: null }],
};

const WORKTREES: Record<string, { path: string; head: string; branch: string | null }[]> = {
  [MAIN]: [
    { path: MAIN, head: "a".repeat(40), branch: "main" },
    { path: FEAT, head: "b".repeat(40), branch: "feat/x" },
  ],
  [SITE]: [{ path: SITE, head: "c".repeat(40), branch: "main" }],
};

const STATUS: Record<string, { status: string; path: string }[]> = {
  [MAIN]: [{ status: "M", path: "src/a.ts" }],
  [FEAT]: [
    { status: "??", path: "src/feat.ts" },
    { status: "M", path: "x.ts" },
  ],
};

export const GREP = [
  { relativePath: "src/a.ts", project: "", matches: [{ line: 15, text: "const area = width * height;" }] },
  {
    relativePath: "src/b.ts",
    project: "",
    matches: [
      { line: 2, text: "area one" },
      { line: 9, text: "area two" },
    ],
  },
];

const text = (body: string) => new Response(body, { status: 200, headers: { "Content-Type": "text/plain" } });

/** `routes` answer before the defaults: URL fragment → handler. */
export function codeFetch(routes: Record<string, FetchHandler> = {}) {
  return stubFetch(routes, (url: string) => {
    const u = new URL(url, "http://x");
    const repo = u.searchParams.get("repo") ?? "";
    if (u.pathname === "/api/prs") return jsonResponse({ me: "me", prs: [], unavailable: [] });
    if (u.pathname === "/api/git/tree") return jsonResponse({ files: TREES[repo] ?? [] });
    if (u.pathname === "/api/git/worktrees") return jsonResponse(WORKTREES[repo] ?? []);
    if (u.pathname === "/api/git/status") return jsonResponse(STATUS[repo] ?? []);
    if (u.pathname === "/api/git/grep") return jsonResponse(GREP);
    if (u.pathname === "/api/git/diff") return jsonResponse({ diff: u.searchParams.get("file") === "src/a.ts" ? A_DIFF : "" });
    if (u.pathname === "/api/git/file") {
      const path = u.searchParams.get("path");
      return text(path === "src/a.ts" ? A_CONTENT : path === "src/b.ts" ? TS_SOURCE : `content of ${path}`);
    }
    return jsonResponse(null);
  });
}

function Search() {
  return <output data-testid="search">{useLocation().search}</output>;
}

export function renderCode(search = "?view=code", routes: Record<string, FetchHandler> = {}) {
  const fetch = codeFetch(routes);
  const utils = render(
    <MemoryRouter initialEntries={[`/project/pavilio/repos${search}`]}>
      <Routes>
        <Route
          path="/project/:name/:section"
          element={
            <>
              <ReposTab project="pavilio" repos={REPOS} />
              <Search />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return { fetch, ...utils };
}

export const urlParams = (el: HTMLElement) => new URLSearchParams(el.textContent ?? "");

export const calls = (fetch: ReturnType<typeof stubFetch>, fragment: string) =>
  fetch.mock.calls.map(([u]) => String(u)).filter((u) => u.includes(fragment));

/** A ResizeObserver the test drives: `resize(width)` reports a new content width to every observer. */
export class DrivenResizeObserver {
  static all: DrivenResizeObserver[] = [];
  constructor(private cb: ResizeObserverCallback) {
    DrivenResizeObserver.all.push(this);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    DrivenResizeObserver.all = DrivenResizeObserver.all.filter((o) => o !== this);
  }
  static resize(width: number): void {
    act(() => {
      for (const o of DrivenResizeObserver.all) {
        o.cb([{ contentRect: { width } } as ResizeObserverEntry], o as unknown as ResizeObserver);
      }
    });
  }
}
