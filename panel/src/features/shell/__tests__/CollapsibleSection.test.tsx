import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CollapsibleSection from "../CollapsibleSection";
import { preferences } from "../../../preferences/declarations";
import { readPreference } from "../../../preferences/store";

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

  it("persists collapsed state and restores it on remount", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <CollapsibleSection storageKey="test.section.c" title="Commands">
        <div data-testid="child">tree</div>
      </CollapsibleSection>
    );
    await user.click(screen.getByRole("button", { name: /commands/i }));
    expect(
      readPreference(preferences.rightSidebarSectionExpanded, "test.section.c"),
    ).toBe(false);

    unmount();

    render(
      <CollapsibleSection storageKey="test.section.c" title="Commands">
        <div data-testid="child">tree</div>
      </CollapsibleSection>
    );
    expect(screen.queryByTestId("child")).not.toBeInTheDocument();
  });
});
