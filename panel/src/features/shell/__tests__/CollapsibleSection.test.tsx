import { describe, it, expect } from "vitest";
import { act, render, screen } from "@testing-library/react";
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

  /**
   * Two clicks in ONE tick. React batches both handlers before it re-renders,
   * so the second one runs against the same render closure as the first: a
   * setter called as `setExpanded(!expanded)` sees the pre-batch value twice,
   * both calls compute the same flip, and the pair collapses into one instead
   * of cancelling. Only an updater — `setExpanded((v) => !v)` — resolves the
   * second call against the first one's result.
   *
   * The same property `useSidebarState`, `useWideMode` and `QuickFinder` each
   * assert; this section was the one place in the migration that lost it.
   */
  it("composes two toggles in one tick", async () => {
    render(
      <CollapsibleSection storageKey="test.section.d" title="Explorer">
        <div data-testid="child">tree</div>
      </CollapsibleSection>
    );
    const button = screen.getByRole("button", { name: /explorer/i });

    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("child")).toBeVisible();
    expect(
      readPreference(preferences.rightSidebarSectionExpanded, "test.section.d"),
    ).toBe(true);
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
