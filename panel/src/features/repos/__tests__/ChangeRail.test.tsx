import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ChangeRail, { changeRuns } from "../ChangeRail";

const EMPTIED = ["diff --git a/x.ts b/x.ts", "--- a/x.ts", "+++ b/x.ts", "@@ -1,2 +0,0 @@", "-one", "-two"].join("\n");

describe("ChangeRail", () => {
  it("an emptied but still present file keeps its rail entry", () => {
    render(<ChangeRail diff={EMPTIED} onJump={vi.fn()} />);
    const rail = screen.getByRole("complementary", { name: "Changes in this file" });
    expect(rail).not.toHaveTextContent("File deleted");
    expect(within(rail).getAllByRole("button")).toHaveLength(1);
  });

  it("a deleted file offers no jumps", () => {
    render(<ChangeRail diff={EMPTIED} deleted onJump={vi.fn()} />);
    const rail = screen.getByRole("complementary", { name: "Changes in this file" });
    expect(rail).toHaveTextContent("File deleted");
    expect(within(rail).queryAllByRole("button")).toHaveLength(0);
  });

  it("a pure removal jumps to its first removed (old-side) line; others to the new side", () => {
    const diff = ["--- a/x.ts", "+++ b/x.ts", "@@ -3,4 +3,3 @@", " three", "-gone 4", "-gone 5", " six", "+new", ""].join("\n");
    expect(changeRuns(diff)).toEqual([
      { line: 4, oldLine: 4, add: 0, del: 2 },
      { line: 5, add: 1, del: 0 },
    ]);
    const onJump = vi.fn();
    render(<ChangeRail diff={diff} onJump={onJump} />);
    const [removal, addition] = within(screen.getByRole("complementary", { name: "Changes in this file" })).getAllByRole("button");
    fireEvent.click(removal);
    expect(onJump).toHaveBeenLastCalledWith(4, "old");
    fireEvent.click(addition);
    expect(onJump).toHaveBeenLastCalledWith(5, "new");
  });

  it("an emptied file's removal targets old line 1", () => {
    const onJump = vi.fn();
    render(<ChangeRail diff={EMPTIED} onJump={onJump} />);
    fireEvent.click(within(screen.getByRole("complementary", { name: "Changes in this file" })).getByRole("button"));
    expect(onJump).toHaveBeenCalledWith(1, "old");
  });
});
