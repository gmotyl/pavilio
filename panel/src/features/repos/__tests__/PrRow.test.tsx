import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PrRow from "../PrRow";
import { pr } from "./prFixtures";

const row = (props: Partial<Parameters<typeof PrRow>[0]> = {}) =>
  render(
    <ul role="listbox">
      <PrRow pr={pr({ number: 7, reviewDecision: "approved" })} me={null} onOpen={vi.fn()} {...props} />
    </ul>,
  );

describe("PrRow", () => {
  it("extra badges follow the review badge in the meta line", () => {
    row({ extraBadges: <span data-testid="extra">Story behind</span> });
    const meta = screen.getByTestId("extra").closest(".pr-meta");
    expect(meta).not.toBeNull();
    const approved = screen.getByText("Approved");
    expect(approved.compareDocumentPosition(screen.getByTestId("extra")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the icon takes the merged or closed variant from state; open and no state keep the plain icon", () => {
    const { unmount } = row({ state: "merged" });
    expect(document.querySelector(".pr-ic")?.className).toBe("pr-ic pr-ic-merged");
    unmount();
    row({ state: "closed" });
    expect(document.querySelector(".pr-ic")?.className).toBe("pr-ic pr-ic-closed");
  });

  it("without state or extra badges the row is the PRs list's row", () => {
    row();
    expect(document.querySelector(".pr-ic")?.className).toBe("pr-ic");
    expect(document.querySelectorAll(".pr-meta > *")).toHaveLength(6);
  });

  it("a merged or closed PR shows no review badge; an open one keeps it", () => {
    const merged = row({ state: "merged" });
    expect(screen.queryByText("Approved")).toBeNull();
    merged.unmount();
    const closed = row({ state: "closed" });
    expect(screen.queryByText("Approved")).toBeNull();
    closed.unmount();
    row({ state: "open" });
    expect(screen.getByText("Approved")).toBeTruthy();
  });

  it("standalone drops the option semantics: no option role, no aria-selected, not in the tab order", () => {
    render(<PrRow pr={pr({ number: 7 })} me={null} onOpen={vi.fn()} standalone />);
    const el = screen.getByTestId("pr-row-pavilio#7");
    expect(el.tagName).toBe("DIV");
    expect(el.getAttribute("role")).toBeNull();
    expect(el.hasAttribute("aria-selected")).toBe(false);
    expect(el.hasAttribute("tabindex")).toBe(false);
    expect(screen.queryByRole("option")).toBeNull();
  });
});
