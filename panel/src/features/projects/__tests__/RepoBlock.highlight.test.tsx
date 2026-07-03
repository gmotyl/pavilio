import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import RepoBlock from "../RepoBlock";

const gitChangesProps = vi.fn();
const gitBranchDiffProps = vi.fn();

vi.mock("../../git/GitChanges", () => ({
  default: (props: Record<string, unknown>) => {
    gitChangesProps(props);
    return null;
  },
}));
vi.mock("../../git/GitBranchDiff", () => ({
  default: (props: Record<string, unknown>) => {
    gitBranchDiffProps(props);
    return null;
  },
}));
vi.mock("../../git/GitWorktrees", () => ({ default: () => null }));
vi.mock("../../git/GitHistory", () => ({ default: () => null }));

const baseProps = {
  repo: { name: "pavilio", path: "/tmp/pavilio" },
  viewMode: "unified" as const,
  onViewModeChange: () => {},
  wideToggle: null,
  repoOpenFile: null,
  onSetRepoOpenFile: () => {},
  branchFile: null,
  onBranchFileChange: () => {},
  activeSha: null,
  activeFile: null,
  onActiveShaChange: () => {},
  onActiveFileChange: () => {},
  commitsOpen: false,
  onCommitsOpenChange: () => {},
  showListSidebar: true,
};

describe("RepoBlock liveHighlight", () => {
  it("forwards liveHighlight to GitChanges and GitBranchDiff", () => {
    render(<RepoBlock {...baseProps} liveHighlight="fit" />);
    expect(gitChangesProps).toHaveBeenCalledWith(
      expect.objectContaining({ highlight: "fit" }),
    );
    expect(gitBranchDiffProps).toHaveBeenCalledWith(
      expect.objectContaining({ highlight: "fit" }),
    );
  });

  it("liveHighlight wins over repoOpenFile.highlight", () => {
    render(
      <RepoBlock
        {...baseProps}
        liveHighlight="fit"
        repoOpenFile={{ repo: "/tmp/pavilio", file: "a.ts", scope: "changed", highlight: "old" }}
      />,
    );
    expect(gitChangesProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ highlight: "fit" }),
    );
  });

  it("falls back to scoped repoOpenFile.highlight when liveHighlight is absent", () => {
    render(
      <RepoBlock
        {...baseProps}
        repoOpenFile={{ repo: "/tmp/pavilio", file: "a.ts", scope: "changed", highlight: "old" }}
      />,
    );
    expect(gitChangesProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ highlight: "old" }),
    );
    expect(gitBranchDiffProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ highlight: undefined }),
    );
  });
});
