import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { filterSkills, useSkills, type SkillEntry } from "../commandSource";

const skill = (name: string, description = ""): SkillEntry => ({
  name,
  description,
  path: `skills/${name}/SKILL.md`,
});

// Deliberately out of order, as GET /api/skills makes no ordering promise.
const ALL: SkillEntry[] = [
  skill("pavilio-note", "Process a meeting transcript into structured notes"),
  skill("agent-browser", "Browser automation CLI for AI agents"),
  skill("pavilio-memo", "Capture a quick thought for a project"),
  skill("tempo", "Tempo Timesheet Helper"),
];

const names = (list: SkillEntry[]) => list.map((s) => s.name);

// Resembles the workspace's real skill list, so ranking is exercised against
// realistic competitors (shared `pavilio-` prefix, repeated segments).
const REAL: SkillEntry[] = [
  skill("pavilio-writing-plans", "Write a bite-sized, contract-style implementation plan"),
  skill("pavilio-note", "Process a meeting transcript into structured project notes"),
  skill("pavilio-archive-plan", "Archive a shipped change OpenSpec-style"),
  skill("pavilio-audit", "Deep, evidence-based repository audit"),
  skill("pavilio-bootstrap", "Generate PROJECT.md, STATUS.md and _index.json"),
  skill("pavilio-code-review", "Two-axis review of the diff between HEAD and a fixed point"),
  skill("pavilio-compact", "Package the session's remaining work into a handoff file"),
  skill("pavilio-create-skill", "Scaffold a new workspace skill"),
  skill("pavilio-execute-plan", "Orchestrate execution of a written implementation plan"),
  skill("pavilio-memo-grill", "Grill a technical documentation topic one question at a time"),
  skill("pavilio-grill", "Stress-test an idea or plan into a sharp design"),
  skill("pavilio-handoff", "Delegate a described task by prebaking a handoff file"),
  skill("pavilio-manager", "Proactive managing developer/architect advisor"),
  skill("pavilio-memo", "Capture a quick thought or note for a project"),
  skill("pavilio-memo-explain", "Create a memo with mermaid diagrams"),
  skill("pavilio-note-batch", "Batch-process unprocessed meetings"),
  skill("pavilio-question", "Answer questions from accumulated project notes"),
  skill("pavilio-resume", "Execute a handoff file prebaked by pavilio-manager"),
  skill("pavilio-search", "Gather a project's accumulated context"),
  skill("pavilio-session-end", "Verify session progress is captured"),
  skill("pavilio-session-start", "Starts or resumes a project session"),
];

describe("filterSkills", () => {
  it.each<[label: string, list: SkillEntry[], query: string, expected: string[]]>([
    ["an empty query returns every skill alphabetically", ALL, "", ["agent-browser", "pavilio-memo", "pavilio-note", "tempo"]],
    ["a whitespace-only query is treated as empty", ALL, "   ", ["agent-browser", "pavilio-memo", "pavilio-note", "tempo"]],
    ["surrounding whitespace in the query is ignored", ALL, "  memo ", ["pavilio-memo"]],
    ["matches on a fragment of the name", ALL, "avilio-n", ["pavilio-note"]],
    ["matches on the description alone", ALL, "transcript", ["pavilio-note"]],
    ["matching is case-insensitive (name)", ALL, "TEMPO", ["tempo"]],
    ["matching is case-insensitive (description)", ALL, "browser AUTOMATION", ["agent-browser"]],
    ["no match returns an empty list", ALL, "zzz-nothing", []],
    // Out of order is no match: "e" before "n" is not a subsequence of "note".
    ["characters out of order do not match", [skill("pavilio-note")], "pveton", []],
    // Neither description contains the term: only the name can match.
    ["matches the name alone case-insensitively", [skill("Zebra-Tool", "does things"), skill("other", "unrelated")], "zebra", ["Zebra-Tool"]],
    ["matches the name alone case-insensitively, mixed case", [skill("Zebra-Tool", "does things"), skill("other", "unrelated")], "ZEBRA-t", ["Zebra-Tool"]],
    [
      "ranks a whole-segment match first and shorter names above longer",
      [
        skill("pavilio-note-batch", "Batch-process unprocessed meetings"),
        skill("pavilio-memo", "Capture a quick thought for a project"),
        skill("pavilio-note", "Process a meeting transcript"),
      ],
      "note",
      ["pavilio-note", "pavilio-note-batch"],
    ],
    // Greedy leftmost would take session's "s" and start's "t" apart (5), the
    // same as safety-review's, and the alphabetical tie-break would put safety
    // first. The best alignment is start's own "st" run (7).
    [
      "scores the best alignment, not the leftmost one",
      [skill("pavilio-safety-review", "Review a change for safety"), skill("pavilio-session-start", "Starts or resumes a project session")],
      "st",
      ["pavilio-session-start", "pavilio-safety-review"],
    ],
    ["breaks an equal score and length alphabetically", [skill("pavilio-note-sync"), skill("pavilio-note-push")], "note", ["pavilio-note-push", "pavilio-note-sync"]],
    [
      "description-only matches sit below every name match",
      [skill("pavilio-note", "Process a meeting transcript into notes"), skill("whisper-transcript", "Speech to text")],
      "transcript",
      ["whisper-transcript", "pavilio-note"],
    ],
    // Plain `<` compare: "-" (0x2d) sorts before ":" (0x3a) and letters.
    ["orders by code unit, independent of locale", [skill("a:b"), skill("ab"), skill("a-b")], "", ["a-b", "a:b", "ab"]],
  ])("%s", (_label, list, query, expected) => {
    expect(names(filterSkills(list, query))).toEqual(expected);
  });

  // Ranking against the realistic list (shared `pavilio-` prefix, repeated segments).
  it.each<[label: string, query: string, top: string[], alsoMatches: string[]]>([
    ["a whole-segment match ranks first", "compact", ["pavilio-compact"], []],
    ["characters match in order across segments", "pvnote", ["pavilio-note"], ["pavilio-note-batch"]],
    // Only "g" opens a segment; "r" continues the run and "l" follows it.
    // memo-grill matches the same way, so the shorter name wins.
    ["segment starts outrank scattered letters, shorter name breaks the tie", "grl", ["pavilio-grill"], []],
    // "m" and "g" both open segments in memo-grill, but "g" is buried mid-word
    // in manager: segment starts beat the shorter name.
    ["segment starts outrank a shorter name", "mg", ["pavilio-memo-grill", "pavilio-manager"], []],
  ])("ranks the real skill list: %s", (_label, query, top, alsoMatches) => {
    const result = names(filterSkills(REAL, query));
    expect(result.slice(0, top.length)).toEqual(top);
    for (const name of alsoMatches) expect(result).toContain(name);
  });

  it("an empty query sorts a copy and never mutates the input", () => {
    const input = [...REAL];
    const result = filterSkills(input, "");
    expect(names(result)).toEqual(names(REAL).slice().sort());
    expect(result).toHaveLength(REAL.length);
    expect(names(input)).toEqual(names(REAL));
    expect(result).not.toBe(input);

    // A fresh, out-of-order array: an in-place sort would visibly reorder it.
    const small = [skill("zulu"), skill("alpha"), skill("mike")];
    const sorted = filterSkills(small, "");
    expect(names(small)).toEqual(["zulu", "alpha", "mike"]);
    expect(names(sorted)).toEqual(["alpha", "mike", "zulu"]);
    expect(sorted).not.toBe(small);
  });
});

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

describe("useSkills", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("loads the skills from GET /api/skills on mount", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse([skill("tempo")]));
    const { result } = renderHook(() => useSkills());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith("/api/skills");
    expect(names(result.current.skills)).toEqual(["tempo"]);
    expect(result.current.error).toBe(false);
  });

  it("a failed fetch yields an empty list and the error flag", async () => {
    fetchMock.mockReturnValueOnce(Promise.reject(new Error("offline")));
    const { result } = renderHook(() => useSkills());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.skills).toEqual([]);
    expect(result.current.error).toBe(true);
  });

  it("a non-ok response yields an empty list and the error flag", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ error: "boom" }, 500));
    const { result } = renderHook(() => useSkills());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.skills).toEqual([]);
    expect(result.current.error).toBe(true);
  });

  it("refresh() re-fetches so a newly added skill appears", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse([skill("tempo")]))
      .mockReturnValueOnce(jsonResponse([skill("tempo"), skill("fresh")]));
    const { result } = renderHook(() => useSkills());
    await waitFor(() => expect(result.current.skills).toHaveLength(1));
    await act(() => result.current.refresh());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(names(result.current.skills)).toEqual(["tempo", "fresh"]);
  });

  it("the latest request wins when responses arrive out of order", async () => {
    let resolveFirst: (r: Response) => void = () => {};
    let resolveSecond: (r: Response) => void = () => {};
    fetchMock
      .mockReturnValueOnce(new Promise<Response>((r) => (resolveFirst = r)))
      .mockReturnValueOnce(new Promise<Response>((r) => (resolveSecond = r)));
    const { result } = renderHook(() => useSkills());
    let second: Promise<void> = Promise.resolve();
    act(() => {
      second = result.current.refresh();
    });

    // The newer request answers first, then the stale one straggles in.
    await act(async () => {
      resolveSecond(await jsonResponse([skill("fresh")]));
      await second;
    });
    await act(async () => {
      resolveFirst(await jsonResponse([skill("stale")]));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(names(result.current.skills)).toEqual(["fresh"]);
    expect(result.current.loading).toBe(false);
  });

  describe("after unmount", () => {
    let errors: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      errors = vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
      errors.mockRestore();
    });

    it("a response landing after unmount sets no state", async () => {
      let resolveFetch: (r: Response) => void = () => {};
      fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolveFetch = r)));
      const { result, unmount } = renderHook(() => useSkills());
      const before = result.current;
      unmount();

      resolveFetch(await jsonResponse([skill("late")]));
      await new Promise((r) => setTimeout(r, 0));

      // No re-render delivered a new result, and React reported nothing.
      expect(result.current).toBe(before);
      expect(result.current.skills).toEqual([]);
      expect(errors).not.toHaveBeenCalled();
    });
  });

  it("a later successful refresh clears the error flag", async () => {
    fetchMock
      .mockReturnValueOnce(Promise.reject(new Error("offline")))
      .mockReturnValueOnce(jsonResponse([skill("tempo")]));
    const { result } = renderHook(() => useSkills());
    await waitFor(() => expect(result.current.error).toBe(true));
    await act(() => result.current.refresh());
    expect(result.current.error).toBe(false);
    expect(names(result.current.skills)).toEqual(["tempo"]);
  });

  it("a failed refresh empties a previously loaded list, as documented", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse([skill("tempo")]))
      // Created lazily: an eager rejected promise is unhandled until used.
      .mockImplementationOnce(() => Promise.reject(new Error("offline")));
    const { result } = renderHook(() => useSkills());
    await waitFor(() => expect(result.current.skills).toHaveLength(1));
    await act(() => result.current.refresh());
    // "A failed or non-ok fetch yields an empty list with `error: true`".
    expect(result.current.skills).toEqual([]);
    expect(result.current.error).toBe(true);
  });
});
