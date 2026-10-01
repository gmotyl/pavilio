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
  it("an empty query returns every skill alphabetically", () => {
    expect(names(filterSkills(ALL, ""))).toEqual([
      "agent-browser",
      "pavilio-memo",
      "pavilio-note",
      "tempo",
    ]);
  });

  it("a whitespace-only query is treated as empty", () => {
    expect(names(filterSkills(ALL, "   "))).toEqual(names(filterSkills(ALL, "")));
  });

  it("surrounding whitespace in the query is ignored", () => {
    expect(names(filterSkills(ALL, "  memo "))).toEqual(["pavilio-memo"]);
  });

  it("matches on a fragment of the name", () => {
    expect(names(filterSkills(ALL, "avilio-n"))).toEqual(["pavilio-note"]);
  });

  it("matches on the description alone", () => {
    expect(names(filterSkills(ALL, "transcript"))).toEqual(["pavilio-note"]);
  });

  it("matching is case-insensitive", () => {
    expect(names(filterSkills(ALL, "TEMPO"))).toEqual(["tempo"]);
    expect(names(filterSkills(ALL, "browser AUTOMATION"))).toEqual(["agent-browser"]);
  });

  it("no match returns an empty list", () => {
    expect(filterSkills(ALL, "zzz-nothing")).toEqual([]);
  });

  it("ranks a whole-segment match first and shorter names above longer", () => {
    const list = [
      skill("pavilio-note-batch", "Batch-process unprocessed meetings"),
      skill("pavilio-memo", "Capture a quick thought for a project"),
      skill("pavilio-note", "Process a meeting transcript"),
    ];
    expect(names(filterSkills(list, "note"))).toEqual(["pavilio-note", "pavilio-note-batch"]);
    expect(names(filterSkills(REAL, "compact"))[0]).toBe("pavilio-compact");
  });

  it("matches characters in order across segments", () => {
    const result = names(filterSkills(REAL, "pvnote"));
    expect(result[0]).toBe("pavilio-note");
    expect(result).toContain("pavilio-note-batch");
    // Out of order is no match: "e" before "n" is not a subsequence of "note".
    expect(names(filterSkills([skill("pavilio-note")], "pveton"))).toEqual([]);
  });

  it("segment starts outrank scattered letters", () => {
    // Only "g" opens a segment; "r" continues the run and "l" follows it.
    // memo-grill matches the same way, so the shorter name wins.
    expect(names(filterSkills(REAL, "grl"))[0]).toBe("pavilio-grill");
    // "m" and "g" both open segments in memo-grill, but "g" is buried
    // mid-word in manager: segment starts beat the shorter name.
    expect(names(filterSkills(REAL, "mg")).slice(0, 2)).toEqual([
      "pavilio-memo-grill",
      "pavilio-manager",
    ]);
  });

  it("scores the best alignment, not the leftmost one", () => {
    // Greedy leftmost would take session's "s" and start's "t" apart (5), the
    // same as safety-review's, and the alphabetical tie-break would put
    // safety first. The best alignment is start's own "st" run (7).
    const list = [
      skill("pavilio-safety-review", "Review a change for safety"),
      skill("pavilio-session-start", "Starts or resumes a project session"),
    ];
    expect(names(filterSkills(list, "st"))).toEqual([
      "pavilio-session-start",
      "pavilio-safety-review",
    ]);
  });

  it("breaks an equal score and length alphabetically", () => {
    const list = [skill("pavilio-note-sync"), skill("pavilio-note-push")];
    expect(names(filterSkills(list, "note"))).toEqual(["pavilio-note-push", "pavilio-note-sync"]);
  });

  it("description-only matches sit below every name match", () => {
    const list = [
      skill("pavilio-note", "Process a meeting transcript into notes"),
      skill("whisper-transcript", "Speech to text"),
    ];
    expect(names(filterSkills(list, "transcript"))).toEqual([
      "whisper-transcript",
      "pavilio-note",
    ]);
  });

  it("empty query is the full alphabetical list", () => {
    const input = [...REAL];
    const result = filterSkills(input, "");
    expect(names(result)).toEqual(names(REAL).slice().sort());
    expect(result).toHaveLength(REAL.length);
    expect(names(input)).toEqual(names(REAL));
    expect(result).not.toBe(input);
  });

  it("orders by code unit, independent of locale", () => {
    // Plain `<` compare: "-" (0x2d) sorts before ":" (0x3a) and letters.
    const list = [skill("a:b"), skill("ab"), skill("a-b")];
    expect(names(filterSkills(list, ""))).toEqual(["a-b", "a:b", "ab"]);
  });

  it("does not mutate the input array", () => {
    // A fresh, out-of-order array: an in-place sort would visibly reorder it.
    const input = [skill("zulu"), skill("alpha"), skill("mike")];
    const result = filterSkills(input, "");
    expect(names(input)).toEqual(["zulu", "alpha", "mike"]);
    expect(names(result)).toEqual(["alpha", "mike", "zulu"]);
    expect(result).not.toBe(input);
  });

  it("matches the name alone case-insensitively", () => {
    // Neither description contains the term: only the name can match.
    const list = [skill("Zebra-Tool", "does things"), skill("other", "unrelated")];
    expect(names(filterSkills(list, "zebra"))).toEqual(["Zebra-Tool"]);
    expect(names(filterSkills(list, "ZEBRA-t"))).toEqual(["Zebra-Tool"]);
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
