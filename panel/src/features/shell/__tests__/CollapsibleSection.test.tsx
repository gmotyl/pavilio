import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CollapsibleSection from "../CollapsibleSection";

describe("CollapsibleSection", () => {
  it("renders children expanded by default", () => {
    render(
      <CollapsibleSection storageKey="test.section.a" title="Explorer">
        <div data-testid="child">tree contents</div>
      </CollapsibleSection>
    );
    expect(screen.getByTestId("child")).toBeVisible();
    expect(screen.getByRole("button", { name: /explorer/i })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
  });

  it("hides children after the user clicks to collapse", async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleSection storageKey="test.section.b" title="Skills">
        <div data-testid="child">tree</div>
      </CollapsibleSection>
    );
    await user.click(screen.getByRole("button", { name: /skills/i }));
    expect(screen.queryByTestId("child")).not.toBeInTheDocument();
  });
});
