import { act, fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, type FetchHandler } from "../../../test-utils";
import { useDefinitionNav } from "../useDefinitionNav";
import { calls, DrivenResizeObserver, MAIN, renderCode, urlParams } from "./codeHarness";

const search = () => urlParams(screen.getByTestId("search"));
const back = () => screen.getByTestId("code-back");
const header = () => screen.getByTestId("file-viewer-header");
const sym = (line: number, name: string) =>
  screen.getByTestId("file-viewer-body").querySelector<HTMLElement>(`tr[data-line="${line}"] [data-sym="${name}"]`);

/** Opens src/b.ts (TS_SOURCE) and waits for `inner` on line 3 to be clickable. */
async function openB(definition: FetchHandler) {
  const r = renderCode("?view=code&file=src/b.ts", { "/api/code/definition": definition });
  await waitFor(() => expect(sym(3, "inner")).not.toBeNull());
  return r;
}

const at = (...locations: { path: string; line: number; col: number }[]) => () => jsonResponse({ locations });

beforeEach(() => {
  DrivenResizeObserver.all = [];
  vi.stubGlobal("ResizeObserver", DrivenResizeObserver);
  vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
});

describe("useDefinitionNav", () => {
  it("clicking an identifier opens its definition and enables Back", async () => {
    const { fetch } = await openB(at({ path: "src/a.ts", line: 15, col: 7 }));
    expect(back()).toBeDisabled();
    fireEvent.click(sym(3, "inner")!);

    await waitFor(() => expect(header()).toHaveTextContent("src/a.ts"));
    expect(calls(fetch, "/api/code/definition")).toEqual([
      `/api/code/definition?repo=${encodeURIComponent(MAIN)}&path=${encodeURIComponent("src/b.ts")}&line=3&col=9`,
    ]);
    expect(search().get("file")).toBe("src/a.ts");
    expect(search().get("line")).toBe("15");
    await waitFor(() => expect(screen.getByTestId("file-viewer-body").querySelector('tr[data-line="15"]')).toHaveClass("fv-flash"));
    expect(back()).toBeEnabled();
  });

  it("Back returns to the previous location", async () => {
    await openB(at({ path: "src/a.ts", line: 15, col: 7 }));
    fireEvent.click(sym(3, "inner")!);
    await waitFor(() => expect(header()).toHaveTextContent("src/a.ts"));

    fireEvent.click(back());
    await waitFor(() => expect(header()).toHaveTextContent("src/b.ts"));
    expect(search().get("file")).toBe("src/b.ts");
    expect(search().get("line")).toBe("3");
    await waitFor(() => expect(screen.getByTestId("file-viewer-body").querySelector('tr[data-line="3"]')).toHaveClass("fv-flash"));
    expect(back()).toBeDisabled();
  });

  it("Back and a late answer after entering Compare return to the working tree they came from", async () => {
    let release = () => {};
    let late = false;
    const A15 = { locations: [{ path: "src/a.ts", line: 15, col: 7 }] };
    renderCode("?view=code&file=src/b.ts", {
      "/api/git/branches": () => jsonResponse({ current: "feat/x", branches: ["main", "feat/x"] }),
      "/api/code/definition": () => (late ? new Promise<Response>((r) => (release = () => r(jsonResponse(A15)))) : jsonResponse(A15)),
    });
    const compareWithMain = async () => {
      fireEvent.click(screen.getByTestId("repo-switcher"));
      const pop = await screen.findByRole("dialog", { name: "Pick a repository or worktree" });
      fireEvent.click(within(pop).getByTestId("compare-with-toggle"));
      fireEvent.click(await within(pop).findByTestId("compare-with-option-main"));
      await waitFor(() => expect(search().get("cmp")).toBe("main"));
    };
    await waitFor(() => expect(sym(3, "inner")).not.toBeNull());

    fireEvent.click(sym(3, "inner")!);
    await waitFor(() => expect(header()).toHaveTextContent("src/a.ts"));
    await compareWithMain();
    fireEvent.click(back());
    await waitFor(() => expect(search().get("file")).toBe("src/b.ts"));
    expect(search().get("cmp")).toBeNull();

    // A lookup started in the working tree answers after Compare began.
    await waitFor(() => expect(sym(3, "inner")).not.toBeNull());
    late = true;
    fireEvent.click(sym(3, "inner")!);
    await compareWithMain();
    await act(async () => release());
    await waitFor(() => expect(search().get("file")).toBe("src/a.ts"));
    expect(search().get("cmp")).toBeNull();
  });

  it("multiple locations show a chooser", async () => {
    const { fetch } = await openB(at({ path: "src/a.ts", line: 15, col: 7 }, { path: "src/b.ts", line: 6, col: 6 }));
    fireEvent.click(sym(3, "inner")!);

    const chooser = await screen.findByRole("group", { name: "Definitions" });
    const options = within(chooser).getAllByRole("button");
    expect(options.map((o) => o.textContent)).toEqual(["src/a.ts:15", "src/b.ts:6"]);
    expect(search().get("file")).toBe("src/b.ts");
    expect(back()).toBeDisabled();

    // Same-file pick only scrolls.
    fireEvent.click(options[1]);
    expect(screen.queryByRole("group", { name: "Definitions" })).toBeNull();
    expect(search().get("file")).toBe("src/b.ts");
    expect(search().get("line")).toBe("6");
    await waitFor(() => expect(screen.getByTestId("file-viewer-body").querySelector('tr[data-line="6"]')).toHaveClass("fv-flash"));
    expect(back()).toBeEnabled();
    expect(calls(fetch, "/api/git/file?repo=")).toHaveLength(1);
  });

  it("no definition shows a transient notice", async () => {
    let fail = false;
    await openB(() => (fail ? jsonResponse({ error: "boom" }, { status: 500 }) : jsonResponse({ locations: [] })));
    fireEvent.click(sym(3, "inner")!);
    const notice = await screen.findByText("No definition found");
    expect(screen.getByTestId("code-backbar")).toContainElement(notice);
    expect(search().get("file")).toBe("src/b.ts");
    expect(back()).toBeDisabled();
    await waitFor(() => expect(screen.queryByText("No definition found")).toBeNull(), { timeout: 3000 });

    fail = true;
    fireEvent.click(sym(3, "inner")!);
    await screen.findByText("No definition found");
    expect(header()).toHaveTextContent("src/b.ts");
  });

  it("non-TypeScript files make no definition calls", async () => {
    const { fetch } = renderCode("?view=code&file=README.md", { "/api/code/definition": at({ path: "src/a.ts", line: 1, col: 1 }) });
    await waitFor(() => expect(screen.getByTestId("file-viewer-body")).toHaveTextContent("content of README.md"));
    expect(screen.getByTestId("file-viewer-body").querySelector("[data-sym]")).toBeNull();
    fireEvent.click(screen.getByTestId("file-viewer-body").querySelector("td.fv-cd")!);
    expect(calls(fetch, "/api/code/definition")).toHaveLength(0);
  });

  it("a definition answer arriving after navigating elsewhere is ignored", async () => {
    let release!: () => void;
    const late = new Promise<void>((r) => (release = r));
    await openB(async () => {
      await late;
      return jsonResponse({ locations: [{ path: "src/a.ts", line: 15, col: 7 }] });
    });
    fireEvent.click(sym(3, "inner")!);
    fireEvent.click(await screen.findByTestId("ft-file-README.md"));
    await waitFor(() => expect(header()).toHaveTextContent("README.md"));
    release();
    await new Promise((r) => setTimeout(r, 30));
    expect(search().get("file")).toBe("README.md");
    expect(back()).toBeDisabled();
  });
  it("the chooser takes focus and closes on Escape or an outside click", async () => {
    await openB(at({ path: "src/a.ts", line: 15, col: 7 }, { path: "src/b.ts", line: 6, col: 6 }));
    fireEvent.click(sym(3, "inner")!);
    const chooser = await screen.findByRole("group", { name: "Definitions" });
    await waitFor(() => expect(within(chooser).getAllByRole("button")[0]).toHaveFocus());
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Definitions" })).toBeNull();

    fireEvent.click(sym(3, "inner")!);
    await screen.findByRole("group", { name: "Definitions" });
    fireEvent.mouseDown(screen.getByTestId("file-viewer-body"));
    expect(screen.queryByRole("group", { name: "Definitions" })).toBeNull();
    expect(search().get("file")).toBe("src/b.ts");
  });

  it("a repeat failure restarts the notice timer and a jump clears it", async () => {
    let answer: "fail" | "hit" = "fail";
    // A failed lookup never reads the body, so fake timers can flush it.
    await openB(() =>
      answer === "fail" ? jsonResponse({ error: "boom" }, { status: 500 }) : jsonResponse({ locations: [{ path: "src/b.ts", line: 6, col: 6 }] }),
    );
    vi.useFakeTimers();
    try {
      fireEvent.click(sym(3, "inner")!);
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(screen.getByText("No definition found")).toBeInTheDocument();
      await act(() => vi.advanceTimersByTimeAsync(1200));
      fireEvent.click(sym(3, "inner")!);
      // Settle the lookup before the first notice's timer is due.
      await act(() => vi.advanceTimersByTimeAsync(0));
      await act(() => vi.advanceTimersByTimeAsync(1200));
      // 2.4 s after the first failure, 1.2 s after the second.
      expect(screen.getByText("No definition found")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }

    answer = "hit";
    fireEvent.click(sym(3, "inner")!);
    await waitFor(() => expect(search().get("line")).toBe("6"));
    expect(screen.queryByText("No definition found")).toBeNull();
  });

  it("Back never stacks a duplicate of the current location", async () => {
    await openB(at({ path: "src/b.ts", line: 6, col: 6 }));
    fireEvent.click(sym(3, "inner")!);
    await waitFor(() => expect(search().get("line")).toBe("6"));
    fireEvent.click(sym(3, "inner")!);
    await waitFor(() => expect(back()).toBeEnabled());
    await new Promise((r) => setTimeout(r, 30));
    fireEvent.click(back());
    await waitFor(() => expect(search().get("line")).toBe("3"));
    expect(back()).toBeDisabled();
  });

  it("a definition at the clicked location adds no Back entry", async () => {
    await openB(at({ path: "src/b.ts", line: 3, col: 9 }));
    fireEvent.click(sym(3, "inner")!);
    await waitFor(() => expect(search().get("line")).toBe("3"));
    await new Promise((r) => setTimeout(r, 30));
    expect(back()).toBeDisabled();
  });

  it("the Back stack keeps the latest 50 entries", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ locations: [{ path: "far.ts", line: 1, col: 1 }] })));
    const open = vi.fn();
    const { result, rerender } = renderHook(({ file }) => useDefinitionNav({ root: MAIN, file, open }), {
      initialProps: { file: "f0.ts" },
    });
    for (let i = 0; i < 60; i++) {
      rerender({ file: `f${i}.ts` });
      await act(async () => {
        result.current.onIdentifierClick({ line: 1, col: 1 });
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    let backs = 0;
    while (result.current.canBack && backs < 100) {
      act(() => result.current.back());
      backs++;
    }
    expect(backs).toBe(50);
    expect(open).toHaveBeenLastCalledWith("f10.ts", 1);
  });

  /** fetch answers each definition lookup only when its `release` runs. */
  function deferredDefinitions() {
    const pending: (() => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) =>
            pending.push(() => resolve(jsonResponse({ locations: [{ path: "late.ts", line: 9, col: 1 }] }))),
          ),
      ),
    );
    return { releaseAll: () => pending.splice(0).forEach((r) => r()) };
  }

  it("a lookup still in flight when the checkout unmounts never navigates", async () => {
    const { releaseAll } = deferredDefinitions();
    const open = vi.fn();
    const { result, unmount } = renderHook(() => useDefinitionNav({ root: MAIN, file: "a.ts", open }));
    act(() => result.current.onIdentifierClick({ line: 1, col: 1 }));
    unmount();
    await act(async () => {
      releaseAll();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(open).not.toHaveBeenCalled();
  });

  it("Back cancels a lookup still in flight", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ locations: [{ path: "a.ts", line: 40, col: 1 }] })));
    const open = vi.fn();
    const { result } = renderHook(() => useDefinitionNav({ root: MAIN, file: "a.ts", open }));
    // A same-file jump: the file never changes, so only Back can retire the next lookup.
    await act(async () => {
      result.current.onIdentifierClick({ line: 1, col: 1 });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(open).toHaveBeenLastCalledWith("a.ts", 40);

    const { releaseAll } = deferredDefinitions();
    act(() => result.current.onIdentifierClick({ line: 40, col: 1 }));
    act(() => result.current.back());
    expect(open).toHaveBeenLastCalledWith("a.ts", 1);
    await act(async () => {
      releaseAll();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(open).toHaveBeenLastCalledWith("a.ts", 1);
  });
});
