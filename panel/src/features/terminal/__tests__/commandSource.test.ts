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
