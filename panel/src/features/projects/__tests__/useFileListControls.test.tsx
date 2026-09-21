import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useFileListControls } from "../fileListControls";
import { preferences } from "../../../preferences/declarations";
import { readPreference, writePreference } from "../../../preferences/store";

function Probe() {
  const { debouncedQuery, sortKey, sortDir, controlsBar } = useFileListControls();
  return (
    <div>
      {controlsBar}
      <span data-testid="dq">{debouncedQuery}</span>
      <span data-testid="key">{sortKey}</span>
      <span data-testid="dir">{sortDir}</span>
    </div>
  );
}

describe("useFileListControls", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("defaults to date/desc and debounces the query by 200ms", () => {
    vi.useFakeTimers();
    render(<Probe />);
    expect(screen.getByTestId("key").textContent).toBe("date");
    expect(screen.getByTestId("dir").textContent).toBe("desc");

    fireEvent.change(screen.getByTestId("file-list-filter-input"), {
      target: { value: "pro" },
    });
    expect(screen.getByTestId("dq").textContent).toBe(""); // not yet
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByTestId("dq").textContent).toBe("pro");
  });

  it("Name button switches sortKey; arrow flips sortDir; both persist", () => {
    render(<Probe />);
    fireEvent.click(screen.getByTestId("file-list-sort-name"));
    fireEvent.click(screen.getByTestId("file-list-sort-dir"));
    expect(screen.getByTestId("key").textContent).toBe("name");
    expect(screen.getByTestId("dir").textContent).toBe("asc");
    expect(readPreference(preferences.fileListSort)).toEqual({
      sortKey: "name",
      sortDir: "asc",
    });
  });

  it("restores a persisted sort on mount", () => {
    writePreference(preferences.fileListSort, { sortKey: "name", sortDir: "asc" });
    render(<Probe />);
    expect(screen.getByTestId("key").textContent).toBe("name");
    expect(screen.getByTestId("dir").textContent).toBe("asc");
  });

  /**
   * The migration changed what this costs: `writeSort` used to be a
   * `localStorage.setItem` and is now a PATCH to the workspace file. A mount
   * that writes therefore puts the DECLARED DEFAULT into the committed file
   * under a key nobody chose — and `FileListSidebar` is mounted by several
   * tabs, so ordinary navigation repeats it.
   */
  it("a cold mount never PATCHes", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);

    // Five sequential mounts, each given its own debounce window — this is
    // ordinary navigation between tabs, not one render burst.
    for (let i = 0; i < 5; i += 1) {
      const { unmount } = render(<Probe />);
      await new Promise((resolve) => setTimeout(resolve, 300));
      unmount();
    }

    expect(fetchMock.mock.calls.filter((c) => c[0] === "/api/preferences")).toEqual([]);
  });

  it("a genuine change issues exactly one PATCH", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);

    render(<Probe />);
    fireEvent.click(screen.getByTestId("file-list-sort-name"));

    await new Promise((resolve) => setTimeout(resolve, 300));

    const patches = fetchMock.mock.calls.filter((c) => c[0] === "/api/preferences");
    expect(patches.length).toBe(1);
    expect(JSON.parse(String(patches[0][1]?.body))).toEqual({
      [preferences.fileListSort.key]: { sortKey: "name", sortDir: "desc" },
    });
  });

  it("clear button empties the query", () => {
    vi.useFakeTimers();
    render(<Probe />);
    fireEvent.change(screen.getByTestId("file-list-filter-input"), {
      target: { value: "abc" },
    });
    fireEvent.click(screen.getByTestId("file-list-filter-clear"));
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByTestId("dq").textContent).toBe("");
    expect(
      (screen.getByTestId("file-list-filter-input") as HTMLInputElement).value,
    ).toBe("");
  });
});
