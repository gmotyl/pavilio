import { describe, it, expect, beforeEach, vi } from "vitest";
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

  it("results stay alphabetical rather than scored", () => {
    // "tempo" matches on both name and description (exact name, even), the
    // others on one field each. A scoring filter would rank "tempo" first;
    // alphabetical order must win.
    const list = [
      skill("zeta", "mentions tempo in passing"),
      skill("tempo", "Tempo Timesheet Helper"),
      skill("alpha-tempo", ""),
    ];
    expect(names(filterSkills(list, "tempo"))).toEqual(["alpha-tempo", "tempo", "zeta"]);
  });

  it("orders by code unit, independent of locale", () => {
    // Plain `<` compare: "-" (0x2d) sorts before ":" (0x3a) and letters.
    const list = [skill("a:b"), skill("ab"), skill("a-b")];
    expect(names(filterSkills(list, ""))).toEqual(["a-b", "a:b", "ab"]);
  });

  it("does not mutate the input array", () => {
    const input = [...ALL];
    filterSkills(input, "");
    expect(input).toEqual(ALL);
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
});
