import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SyncConflictBanner } from "../SyncConflictBanner";

const files = ["panel/a.tsx", "panel/b.tsx", "opencode.json"];

describe("SyncConflictBanner", () => {
  it("renders nothing when there is no conflict", () => {
    const { container } = render(<SyncConflictBanner conflictFiles={[]} conflictPrompt="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the conflicted files and their count", () => {
    render(<SyncConflictBanner conflictFiles={files} conflictPrompt="do the thing" />);
    expect(screen.getByText(/3 files/)).toBeInTheDocument();
    expect(screen.getByText("panel/a.tsx")).toBeInTheDocument();
    expect(screen.getByText("opencode.json")).toBeInTheDocument();
  });

  it("truncates long lists to six entries", () => {
    const many = Array.from({ length: 11 }, (_, i) => `panel/f${i}.tsx`);
    render(<SyncConflictBanner conflictFiles={many} conflictPrompt="p" />);
    expect(screen.getByText("panel/f5.tsx")).toBeInTheDocument();
    expect(screen.queryByText("panel/f6.tsx")).not.toBeInTheDocument();
    expect(screen.getByText("…and 5 more")).toBeInTheDocument();
  });

  it("exposes a copy button carrying the prompt", () => {
    render(<SyncConflictBanner conflictFiles={files} conflictPrompt="do the thing" />);
    const btn = screen.getByTestId("sync-conflict-copy-prompt");
    expect(btn).toBeEnabled();
    expect(btn).toHaveAttribute("aria-label", "Copy conflict resolution prompt");
  });

  it("says the repo is clean so nobody goes hunting for a half-rebase", () => {
    render(<SyncConflictBanner conflictFiles={files} conflictPrompt="p" />);
    expect(screen.getByText(/clean at HEAD/)).toBeInTheDocument();
  });
});
