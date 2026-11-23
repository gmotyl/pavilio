import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { calls, DrivenResizeObserver, MAIN, renderCode, urlParams } from "./codeHarness";

const search = () => urlParams(screen.getByTestId("search"));
const pill = (name: string) => within(screen.getByRole("group", { name: "Repos view" })).getByRole("button", { name });

beforeEach(() => {
  DrivenResizeObserver.all = [];
  vi.stubGlobal("ResizeObserver", DrivenResizeObserver);
  vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
  vi.mocked(Element.prototype.scrollTo).mockClear();
});

describe("FileSearch", () => {
  it("Ctrl+P focuses file search and Enter opens the first match", async () => {
    renderCode("?view=prs");
    const notPrevented = fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    expect(notPrevented).toBe(false);
    expect(pill("Code")).toHaveAttribute("aria-pressed", "true");
    const input = await screen.findByRole("combobox", { name: "Go to file" });
    await waitFor(() => expect(input).toHaveFocus());
    await screen.findByTestId("ft-file-README.md");

    fireEvent.change(input, { target: { value: "srcb" } });
    const results = screen.getByRole("listbox", { name: "Matching files" });
    expect(within(results).getAllByRole("option").map((o) => o.textContent)).toEqual(["src/b.ts"]);

    fireEvent.change(input, { target: { value: "s.ts" } });
    expect(within(results).getAllByRole("option").map((o) => o.textContent)).toEqual(["src/a.ts", "src/b.ts"]);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("");
    expect(screen.queryByRole("listbox", { name: "Matching files" })).toBeNull();

    // ⌘P works too and refocuses.
    input.blur();
    expect(fireEvent.keyDown(window, { key: "p", metaKey: true })).toBe(false);
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.change(input, { target: { value: "rdm" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(search().get("file")).toBe("README.md");
    expect(input).toHaveValue("");
    await waitFor(() => expect(screen.getByTestId("file-viewer-header")).toHaveTextContent("README.md"));
  });

  it("Ctrl+Shift+F lists in-file matches and highlights the query", async () => {
    const { fetch } = renderCode("?view=code");
    await screen.findByTestId("ft-file-README.md");
    expect(fireEvent.keyDown(window, { key: "F", ctrlKey: true, shiftKey: true })).toBe(false);
    const input = await screen.findByRole("combobox", { name: "Search in files" });
    await waitFor(() => expect(input).toHaveFocus());

    fireEvent.change(input, { target: { value: "area" } });
    const results = await screen.findByRole("listbox", { name: "Matches in files" });
    await waitFor(() => expect(within(results).getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["src/a.ts", "src/b.ts"]));
    expect(calls(fetch, `/api/git/grep?q=area&repo=${encodeURIComponent(MAIN)}`)).toHaveLength(1);
    const b = within(results).getAllByRole("group")[1];
    expect(within(b).getAllByRole("option").map((o) => o.textContent)).toEqual(["2area one", "9area two"]);

    fireEvent.click(within(within(results).getAllByRole("group")[0]).getByRole("option"));
    expect(search().get("file")).toBe("src/a.ts");
    expect(search().get("line")).toBe("15");
    await waitFor(() => expect(screen.getByTestId("file-viewer-body").querySelector("mark.fv-hl")).toHaveTextContent("area"));
    await waitFor(() => expect(Element.prototype.scrollTo).toHaveBeenCalled());
  });

  it("a new query hides the previous query's hits until its own arrive", async () => {
    renderCode("?view=code");
    await screen.findByTestId("ft-file-README.md");
    fireEvent.keyDown(window, { key: "F", ctrlKey: true, shiftKey: true });
    const input = await screen.findByRole("combobox", { name: "Search in files" });
    fireEvent.change(input, { target: { value: "area" } });
    const results = await screen.findByRole("listbox", { name: "Matches in files" });
    await waitFor(() => expect(within(results).getAllByRole("group")).toHaveLength(2));

    fireEvent.change(input, { target: { value: "areas" } });
    expect(within(results).queryAllByRole("option")).toHaveLength(0);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(search().get("file")).toBeNull();
  });

  it("arrow keys keep the active option in view and announce it", async () => {
    renderCode("?view=code");
    await screen.findByTestId("ft-file-README.md");
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    const input = await screen.findByRole("combobox", { name: "Go to file" });
    fireEvent.change(input, { target: { value: "s" } });
    const options = within(screen.getByRole("listbox", { name: "Matching files" })).getAllByRole("option");
    expect(input).toHaveAttribute("aria-activedescendant", options[0].id);
    vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", options[1].id);
    expect(options[1].id).not.toBe("");
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(vi.mocked(HTMLElement.prototype.scrollIntoView).mock.contexts.at(-1)).toBe(options[1]);
  });
});
