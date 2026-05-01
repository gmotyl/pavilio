import { describe, expect, test, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useArchivedProjects, archiveStorageKey } from "../useArchivedProjects";

describe("useArchivedProjects", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("starts empty", () => {
    const { result } = renderHook(() => useArchivedProjects());
    expect(result.current.archived).toEqual([]);
    expect(result.current.archivedNames.size).toBe(0);
  });

  test("archives a project and persists", () => {
    const { result } = renderHook(() => useArchivedProjects());
    act(() => result.current.archive("alpha"));
    expect(result.current.archivedNames.has("alpha")).toBe(true);
    expect(JSON.parse(localStorage.getItem(archiveStorageKey)!)).toHaveLength(1);
  });

  test("restoring removes from list", () => {
    const { result } = renderHook(() => useArchivedProjects());
    act(() => result.current.archive("alpha"));
    act(() => result.current.restore("alpha"));
    expect(result.current.archivedNames.has("alpha")).toBe(false);
  });

  test("archive twice is idempotent", () => {
    const { result } = renderHook(() => useArchivedProjects());
    act(() => result.current.archive("alpha"));
    act(() => result.current.archive("alpha"));
    expect(result.current.archived).toHaveLength(1);
  });
});
