import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ChangeRail from "../ChangeRail";

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
});
