import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
