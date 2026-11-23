import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { jsonResponse, stubFetch } from "../../../test-utils";
import RefSwitcher from "../RefSwitcher";
import { FEAT, MAIN, SITE } from "./codeHarness";

const pop = () => screen.getByRole("dialog", { name: "Pick a repository or worktree" });

describe("RefSwitcher", () => {
  it("a linked path that is itself a worktree is the null row; the real main checkout picks by path", () => {
    stubFetch({}, []);
    const onPick = vi.fn();
    render(
      <RefSwitcher
        repos={[{ name: "pavilio", path: FEAT, present: true }]}
        worktrees={{
          pavilio: [
            { path: MAIN, head: "a".repeat(40), branch: "main" },
            { path: FEAT, head: "b".repeat(40), branch: "feat/x" },
          ],
        }}
        repo="pavilio"
        wt={null}
        onPick={onPick}
      />,
    );
    expect(screen.getByTestId("repo-switcher")).toHaveTextContent("feat/x");
    fireEvent.click(screen.getByTestId("repo-switcher"));
    expect(within(pop()).getByTestId(`repo-switcher-wt-${FEAT}`)).toHaveAttribute("aria-current", "true");
    expect(within(pop()).getByTestId(`repo-switcher-wt-${MAIN}`)).not.toHaveAttribute("aria-current");
    fireEvent.click(within(pop()).getByTestId(`repo-switcher-wt-${MAIN}`));
    expect(onPick).toHaveBeenLastCalledWith("pavilio", MAIN);
    fireEvent.click(screen.getByTestId("repo-switcher"));
    fireEvent.click(within(pop()).getByTestId(`repo-switcher-wt-${FEAT}`));
    expect(onPick).toHaveBeenLastCalledWith("pavilio", null);
  });

  it("branches listed for one checkout never show for the next", async () => {
    stubFetch({
      [`/api/git/branches?repo=${encodeURIComponent(MAIN)}`]: () => jsonResponse({ branches: ["only-in-main"] }),
      [`/api/git/branches?repo=${encodeURIComponent(SITE)}`]: () => new Promise<Response>(() => {}),
    }, []);
    const props = {
      repos: [
        { name: "pavilio", path: MAIN, present: true },
        { name: "site", path: SITE, present: true },
      ],
      worktrees: {},
      wt: null,
      onPick: vi.fn(),
      onCompare: vi.fn(),
    };
    const { rerender } = render(<RefSwitcher {...props} repo="pavilio" root={MAIN} />);
    fireEvent.click(screen.getByTestId("repo-switcher"));
    fireEvent.click(within(pop()).getByTestId("compare-with-toggle"));
    await within(pop()).findByTestId("compare-with-option-only-in-main");
    fireEvent.click(screen.getByTestId("repo-switcher"));

    rerender(<RefSwitcher {...props} repo="site" root={SITE} />);
    fireEvent.click(screen.getByTestId("repo-switcher"));
    fireEvent.click(within(pop()).getByTestId("compare-with-toggle"));
    expect(within(pop()).queryByTestId("compare-with-option-only-in-main")).toBeNull();
    fireEvent.keyDown(within(pop()).getByRole("searchbox", { name: "Filter branches" }), { key: "Enter" });
    expect(props.onCompare).not.toHaveBeenCalled();
  });

  describe("missing repo clone", () => {
    const GONE = "/srv/git/infopoly/infopoly-skills";
    const base = { worktrees: {}, repo: null, wt: null, onPick: vi.fn() };
    const missing = (cloneable = false) => [{ name: "infopoly-skills", path: GONE, present: false, ...(cloneable ? { cloneable } : {}) }];

    it("offers Clone next to Not on this machine when repos.json names a remote", () => {
      stubFetch({}, []);
      render(<RefSwitcher {...base} project="infopoly" repos={missing(true)} />);
      fireEvent.click(screen.getByTestId("repo-switcher"));
      const group = within(pop()).getByRole("group", { name: "infopoly-skills" });
      expect(group).toHaveTextContent("Not on this machine");
      const button = within(group).getByTestId("repo-switcher-clone-infopoly-skills");
      expect(button).toHaveTextContent("Clone");
      expect(button.getAttribute("title") ?? "").not.toContain("git@");
    });

    it("shows no Clone button without a remote (no URL is guessed)", () => {
      stubFetch({}, []);
      render(<RefSwitcher {...base} project="infopoly" repos={missing()} />);
      fireEvent.click(screen.getByTestId("repo-switcher"));
      expect(within(pop()).queryByTestId("repo-switcher-clone-infopoly-skills")).toBeNull();
    });

    it("posts the project, repo name and path, then refreshes the project list", async () => {
      const fetch = stubFetch({ "/api/git/clone": { ok: true, path: GONE }, "/api/projects": [] }, []);
      const refreshed = vi.fn();
      window.addEventListener("pavilio:projects-refresh", refreshed);
      try {
        render(<RefSwitcher {...base} project="infopoly" repos={missing(true)} />);
        fireEvent.click(screen.getByTestId("repo-switcher"));
        fireEvent.click(within(pop()).getByTestId("repo-switcher-clone-infopoly-skills"));
        await waitFor(() => expect(refreshed).toHaveBeenCalled());
        const call = fetch.mock.calls.find(([u]) => String(u) === "/api/git/clone");
        expect(call?.[1]?.method).toBe("POST");
        expect(JSON.parse(String(call?.[1]?.body))).toEqual({ project: "infopoly", repo: "infopoly-skills", path: GONE });
      } finally {
        window.removeEventListener("pavilio:projects-refresh", refreshed);
      }
    });

    it("shows the server's error inline when the clone fails", async () => {
      stubFetch(
        { "/api/git/clone": () => jsonResponse({ error: "git clone failed: Permission denied (publickey)" }, { status: 502 }) },
        [],
      );
      render(<RefSwitcher {...base} project="infopoly" repos={missing(true)} />);
      fireEvent.click(screen.getByTestId("repo-switcher"));
      fireEvent.click(within(pop()).getByTestId("repo-switcher-clone-infopoly-skills"));
      expect(await within(pop()).findByRole("alert")).toHaveTextContent("Permission denied (publickey)");
      expect(within(pop()).getByTestId("repo-switcher-clone-infopoly-skills")).toBeEnabled();
    });

    it("a clone error belongs to its path, not a same-named repo at another path", async () => {
      stubFetch({ "/api/git/clone": () => jsonResponse({ error: "boom" }, { status: 502 }) }, []);
      const repos = [
        { name: "infopoly-skills", path: GONE, present: false, cloneable: true },
        { name: "infopoly-skills", path: "/elsewhere/infopoly-skills", present: false, cloneable: true },
      ];
      render(<RefSwitcher {...base} project="infopoly" repos={repos} />);
      fireEvent.click(screen.getByTestId("repo-switcher"));
      fireEvent.click(within(pop()).getAllByTestId("repo-switcher-clone-infopoly-skills")[0]);
      expect(await within(pop()).findByRole("alert")).toHaveTextContent("boom");
      expect(within(pop()).getAllByRole("alert")).toHaveLength(1);
    });

    it("a clone error belongs to its project, not a same-named repo of the next one", async () => {
      stubFetch({ "/api/git/clone": () => jsonResponse({ error: "boom" }, { status: 502 }) }, []);
      const repos = missing(true);
      const { rerender } = render(<RefSwitcher {...base} project="infopoly" repos={repos} />);
      fireEvent.click(screen.getByTestId("repo-switcher"));
      fireEvent.click(within(pop()).getByTestId("repo-switcher-clone-infopoly-skills"));
      expect(await within(pop()).findByRole("alert")).toHaveTextContent("boom");
      rerender(<RefSwitcher {...base} project="other" repos={repos} />);
      expect(within(pop()).queryByRole("alert")).toBeNull();
      rerender(<RefSwitcher {...base} project="infopoly" repos={repos} />);
      expect(within(pop()).getByRole("alert")).toHaveTextContent("boom");
    });
  });
});
