import { fireEvent, render, screen, within } from "@testing-library/react";
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
});
