import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FileTree, { type TreeFile } from "../FileTree";

const FILES: TreeFile[] = [
  { path: "src/b.ts", status: null },
  { path: "src/a.ts", status: "M", add: 3, del: 1 },
  { path: "src/lib/deep.ts", status: "A", add: 5, del: 0 },
  { path: "README.md", status: null },
  { path: "docs/guide.md", status: null },
  { path: "z.ts", status: "D" },
];

const rowNames = () => screen.getAllByRole("button").map((b) => b.getAttribute("data-name"));
const folder = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}\\b`) });

describe("FileTree", () => {
  it("renders folders collapsible and sorted", () => {
    render(<FileTree files={FILES} onSelect={() => {}} />);
    expect(rowNames()).toEqual(["docs", "src", "README.md", "z.ts"]);
    expect(folder("src")).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(folder("src"));
    expect(folder("src")).toHaveAttribute("aria-expanded", "true");
    expect(rowNames()).toEqual(["docs", "src", "lib", "a.ts", "b.ts", "README.md", "z.ts"]);

    fireEvent.click(folder("src"));
    expect(rowNames()).toEqual(["docs", "src", "README.md", "z.ts"]);
  });

  it("badges changed files with status and counts", () => {
    const onSelect = vi.fn();
    render(<FileTree files={FILES} onSelect={onSelect} />);
    fireEvent.click(folder("src"));

    const a = screen.getByRole("button", { name: /a\.ts/ });
    expect(a).toHaveTextContent("M");
    expect(a).toHaveTextContent("+3 −1");
    expect(a).not.toHaveClass("unchanged");

    const z = screen.getByRole("button", { name: /z\.ts/ });
    expect(z).toHaveTextContent("D");
    expect(z).not.toHaveTextContent("+");

    expect(screen.getByRole("button", { name: /b\.ts/ })).toHaveClass("unchanged");
    expect(screen.getByRole("button", { name: /README/ })).toHaveClass("unchanged");

    fireEvent.click(a);
    expect(onSelect).toHaveBeenCalledWith("src/a.ts");

    fireEvent.click(folder("lib"));
    const deep = screen.getByRole("button", { name: /deep\.ts/ });
    expect(deep).toHaveTextContent("A");
    expect(deep).toHaveTextContent("+5 −0");
  });

  it("sorts case-insensitively and numerically", () => {
    const files: TreeFile[] = ["b10.ts", "B2.ts", "a.ts", "b1.ts"].map((path) => ({ path }));
    render(<FileTree files={files} onSelect={() => {}} />);
    expect(rowNames()).toEqual(["a.ts", "b1.ts", "B2.ts", "b10.ts"]);
  });

  it("gives every row a test id", () => {
    render(<FileTree files={FILES} onSelect={() => {}} />);
    expect(screen.getByTestId("ft-dir-src")).toBe(folder("src"));
    expect(screen.getByTestId("ft-file-README.md")).toHaveAttribute("data-name", "README.md");
  });

  it("dots a collapsed folder that hides changes", () => {
    render(<FileTree files={FILES} onSelect={() => {}} />);
    expect(folder("src").querySelector(".ft-dot")).not.toBeNull();
    expect(folder("src")).toHaveAccessibleName("src contains changes");
    expect(folder("docs").querySelector(".ft-dot")).toBeNull();
    expect(folder("docs")).toHaveAccessibleName("docs");

    fireEvent.click(folder("src"));
    expect(folder("src").querySelector(".ft-dot")).toBeNull();
    expect(folder("lib").querySelector(".ft-dot")).not.toBeNull();
  });

  it("opens ancestors of the selected file", () => {
    const { rerender } = render(<FileTree files={FILES} onSelect={() => {}} />);
    expect(screen.queryByRole("button", { name: /deep\.ts/ })).toBeNull();

    rerender(<FileTree files={FILES} selected="src/lib/deep.ts" onSelect={() => {}} />);
    expect(folder("src")).toHaveAttribute("aria-expanded", "true");
    expect(folder("lib")).toHaveAttribute("aria-expanded", "true");
    const deep = screen.getByRole("button", { name: /deep\.ts/ });
    expect(deep).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: /a\.ts/ })).not.toHaveAttribute("aria-current");
  });

  it("keeps a folder the user collapsed closed while the selection is unchanged", () => {
    const { rerender } = render(<FileTree files={FILES} selected="src/lib/deep.ts" onSelect={() => {}} />);
    fireEvent.click(folder("lib"));
    expect(folder("lib")).toHaveAttribute("aria-expanded", "false");

    rerender(<FileTree files={FILES} selected="src/lib/deep.ts" onSelect={() => {}} />);
    expect(folder("lib")).toHaveAttribute("aria-expanded", "false");
  });

  it("changedOnly hides unchanged files", () => {
    render(<FileTree files={FILES} changedOnly selected="src/a.ts" onSelect={() => {}} />);
    expect(rowNames()).toEqual(["src", "lib", "a.ts", "z.ts"]);
    // Every folder holds changes here, so the dot says nothing.
    expect(document.querySelector(".ft-dot")).toBeNull();
  });
});
