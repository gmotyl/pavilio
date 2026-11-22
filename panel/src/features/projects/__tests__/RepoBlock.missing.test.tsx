import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect } from "react";
import { render, screen, within, cleanup } from "@testing-library/react";
import RepoBlock from "../RepoBlock";

// Each git section stub records its props and issues the request a real
// section would, so the fetch spy proves which repo paths reach the git API.
const sectionProps = vi.fn();

function gitSection(name: string) {
  return {
    default: (props: { repo: string }) => {
      sectionProps(name, props.repo);
      useEffect(() => {
        void fetch(`/api/git/${name}?repo=${encodeURIComponent(props.repo)}`);
      }, [props.repo]);
      return <div data-testid={`section-${name}`} />;
    },
  };
}

vi.mock("../../git/GitChanges", () => gitSection("changes"));
vi.mock("../../git/GitBranchDiff", () => gitSection("branch-diff"));
vi.mock("../../git/GitWorktrees", () => gitSection("worktrees"));
vi.mock("../../git/GitHistory", () => gitSection("history"));

const fetchSpy = vi.fn(async () => new Response("{}"));

const baseProps = {
  viewMode: "flat" as const,
  onViewModeChange: () => {},
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

const missing = { name: "gone", path: "/srv/git/gone", present: false };
const present = { name: "here", path: "/srv/git/here", present: true };

const SECTIONS = ["changes", "branch-diff", "worktrees", "history"];

function gitUrlsFor(path: string): string[] {
  return fetchSpy.mock.calls
    .map((call) => String((call as unknown[])[0]))
    .filter(
      (url) =>
        url.startsWith("/api/git/") &&
        url.includes(`repo=${encodeURIComponent(path)}`),
    );
}

beforeEach(() => {
  sectionProps.mockClear();
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RepoBlock missing repo", () => {
  it("renders name, path and Not on this machine for a missing repo", () => {
    render(<RepoBlock {...baseProps} repo={missing} />);
    expect(screen.getByText("gone")).toBeTruthy();
    expect(screen.getByText("/srv/git/gone")).toBeTruthy();
    expect(screen.getByTestId("repo-copy-path")).toBeTruthy();
    expect(screen.getByTestId("repo-copy-json")).toBeTruthy();
    expect(screen.getByTestId("repo-missing").textContent).toBe(
      "Not on this machine",
    );
  });

  it("makes no git request for a missing repo", () => {
    render(
      <>
        <RepoBlock {...baseProps} repo={present} />
        <RepoBlock {...baseProps} repo={missing} />
      </>,
    );
    // The spy is live: the present repo's sections did reach the git API.
    expect(gitUrlsFor(present.path)).toHaveLength(SECTIONS.length);
    expect(gitUrlsFor(missing.path)).toEqual([]);
    expect(
      sectionProps.mock.calls.filter(([, repo]) => repo === missing.path),
    ).toEqual([]);
  });

  it("a present repo beside a missing one still renders its git sections", () => {
    const { container } = render(
      <>
        <div data-testid="block-present">
          <RepoBlock {...baseProps} repo={present} />
        </div>
        <div data-testid="block-missing">
          <RepoBlock {...baseProps} repo={missing} />
        </div>
      </>,
    );
    expect(container).toBeTruthy();
    const presentBlock = within(screen.getByTestId("block-present"));
    for (const s of SECTIONS) {
      expect(presentBlock.getByTestId(`section-${s}`)).toBeTruthy();
    }
    expect(presentBlock.queryByTestId("repo-missing")).toBeNull();
    const missingBlock = within(screen.getByTestId("block-missing"));
    for (const s of SECTIONS) {
      expect(missingBlock.queryByTestId(`section-${s}`)).toBeNull();
    }
    expect(missingBlock.getByTestId("repo-missing")).toBeTruthy();
  });
});
