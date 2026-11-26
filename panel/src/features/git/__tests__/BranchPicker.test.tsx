import { describe, it, expect, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BranchPicker from "../BranchPicker";

const branches = ["main", "develop", "feature/auth", "feature/search", "fix/login"];

describe("BranchPicker", () => {
  it("renders current branch value", () => {
    render(<BranchPicker branches={branches} value="develop" onChange={() => {}} />);
    expect(screen.getByText("develop")).toBeInTheDocument();
  });

  it("opens dropdown and shows branches on click", async () => {
    const user = userEvent.setup();
    render(<BranchPicker branches={branches} value="main" onChange={() => {}} />);
    await user.click(screen.getByText("main"));
    expect(screen.getByText("feature/auth")).toBeInTheDocument();
    expect(screen.getByText("fix/login")).toBeInTheDocument();
  });

  it("filters branches by typing", async () => {
    const user = userEvent.setup();
    render(<BranchPicker branches={branches} value="main" onChange={() => {}} />);
    await user.click(screen.getByText("main"));
    await user.type(screen.getByPlaceholderText("Filter branches..."), "feature");
    expect(screen.getByText("feature/auth")).toBeInTheDocument();
    expect(screen.getByText("feature/search")).toBeInTheDocument();
    expect(screen.queryByText("fix/login")).not.toBeInTheDocument();
  });

  it("calls onChange when branch selected", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BranchPicker branches={branches} value="main" onChange={onChange} />);
    await user.click(screen.getByText("main"));
    await user.click(screen.getByText("develop"));
    expect(onChange).toHaveBeenCalledWith("develop");
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<BranchPicker branches={branches} value="main" onChange={() => {}} />);
    await user.click(screen.getByText("main"));
    expect(screen.getByPlaceholderText("Filter branches...")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByPlaceholderText("Filter branches...")).not.toBeInTheDocument();
  });

  it("shows placeholder when no value", () => {
    render(<BranchPicker branches={branches} value="" onChange={() => {}} placeholder="pick one" />);
    expect(screen.getByText("pick one")).toBeInTheDocument();
  });

  it("navigates with keyboard arrows and Enter", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BranchPicker branches={branches} value="main" onChange={onChange} />);
    await user.click(screen.getByText("main"));
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("feature/auth");
  });

  describe("popover placement", () => {
    const rect = (left: number, right: number, top = 40, bottom = 60) =>
      ({ left, right, top, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

    it("renders outside the trigger's clipping ancestors with fixed positioning", async () => {
      const user = userEvent.setup();
      render(
        <div data-testid="clip" style={{ overflow: "hidden", width: 120 }}>
          <BranchPicker branches={branches} value="main" onChange={() => {}} testIdPrefix="bp" />
        </div>
      );
      await user.click(screen.getByTestId("bp-toggle"));
      const pop = screen.getByTestId("bp-popover");
      expect(screen.getByTestId("clip").contains(pop)).toBe(false);
      expect(pop.style.position).toBe("fixed");
    });

    it("right-aligned popover is clamped inside the viewport instead of spilling off its left edge", async () => {
      const user = userEvent.setup();
      render(<BranchPicker branches={branches} value="main" onChange={() => {}} testIdPrefix="bp" align="right" />);
      const toggle = screen.getByTestId("bp-toggle");
      toggle.getBoundingClientRect = () => rect(100, 150);
      await user.click(toggle);
      const pop = screen.getByTestId("bp-popover");
      expect(parseFloat(pop.style.left)).toBeGreaterThanOrEqual(8);
      expect(pop.style.top).toBe("64px");
    });

    it("right-aligned popover ends at the trigger's right edge when it fits", async () => {
      const user = userEvent.setup();
      render(<BranchPicker branches={branches} value="main" onChange={() => {}} testIdPrefix="bp" align="right" />);
      const toggle = screen.getByTestId("bp-toggle");
      toggle.getBoundingClientRect = () => rect(600, 700);
      await user.click(toggle);
      const pop = screen.getByTestId("bp-popover");
      expect(parseFloat(pop.style.left) + parseFloat(pop.style.width)).toBe(700);
    });

    it("width never exceeds the viewport", async () => {
      const user = userEvent.setup();
      const prev = window.innerWidth;
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 200 });
      try {
        render(<BranchPicker branches={branches} value="main" onChange={() => {}} testIdPrefix="bp" />);
        const toggle = screen.getByTestId("bp-toggle");
        toggle.getBoundingClientRect = () => rect(20, 60);
        await user.click(toggle);
        const pop = screen.getByTestId("bp-popover");
        expect(parseFloat(pop.style.width)).toBeLessThanOrEqual(184);
        expect(parseFloat(pop.style.left)).toBeGreaterThanOrEqual(8);
      } finally {
        Object.defineProperty(window, "innerWidth", { configurable: true, value: prev });
      }
    });

    it("long branch names ellipsize and keep the full name as a tooltip", async () => {
      const user = userEvent.setup();
      const long = "origin/dependabot/uv/uv-804f26c466-with-a-very-long-suffix";
      render(<BranchPicker branches={[long]} value="main" onChange={() => {}} testIdPrefix="bp" />);
      await user.click(screen.getByTestId("bp-toggle"));
      const opt = screen.getByTestId(`bp-option-${long}`);
      expect(opt).toHaveAttribute("title", long);
      expect(opt.querySelector(".truncate")).toHaveTextContent(long);
    });

    it("a click inside the portalled popover does not close it", async () => {
      const user = userEvent.setup();
      render(<BranchPicker branches={branches} value="main" onChange={() => {}} testIdPrefix="bp" />);
      await user.click(screen.getByTestId("bp-toggle"));
      await user.click(screen.getByPlaceholderText("Filter branches..."));
      expect(screen.getByTestId("bp-popover")).toBeInTheDocument();
    });

    it("closes when the trigger stops being laid out (its column hidden)", async () => {
      const user = userEvent.setup();
      render(<BranchPicker branches={branches} value="main" onChange={() => {}} testIdPrefix="bp" />);
      const toggle = screen.getByTestId("bp-toggle");
      toggle.getBoundingClientRect = () => rect(600, 700);
      await user.click(toggle);
      expect(screen.getByTestId("bp-popover")).toBeInTheDocument();
      toggle.getBoundingClientRect = () => rect(0, 0, 0, 0);
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });
      expect(screen.queryByTestId("bp-popover")).toBeNull();
    });

    const withViewportHeight = async (h: number, run: () => Promise<void>) => {
      const prev = window.innerHeight;
      Object.defineProperty(window, "innerHeight", { configurable: true, value: h });
      try {
        await run();
      } finally {
        Object.defineProperty(window, "innerHeight", { configurable: true, value: prev });
      }
    };
    const list = () => screen.getByTestId("bp-popover").lastElementChild as HTMLElement;

    it("opens below with the full list when there is room", () =>
      withViewportHeight(800, async () => {
        const user = userEvent.setup();
        render(<BranchPicker branches={branches} value="main" onChange={() => {}} testIdPrefix="bp" />);
        const toggle = screen.getByTestId("bp-toggle");
        toggle.getBoundingClientRect = () => rect(600, 700, 40, 60);
        await user.click(toggle);
        const pop = screen.getByTestId("bp-popover");
        expect(pop.style.top).toBe("64px");
        expect(pop.style.bottom).toBe("");
        expect(list().style.maxHeight).toBe("240px");
      }));

    it("flips above the trigger near the viewport bottom", () =>
      withViewportHeight(800, async () => {
        const user = userEvent.setup();
        render(<BranchPicker branches={branches} value="main" onChange={() => {}} testIdPrefix="bp" />);
        const toggle = screen.getByTestId("bp-toggle");
        toggle.getBoundingClientRect = () => rect(600, 700, 740, 760);
        await user.click(toggle);
        const pop = screen.getByTestId("bp-popover");
        expect(pop.style.top).toBe("");
        // 800 viewport − 740 trigger top + 4 gap.
        expect(pop.style.bottom).toBe("64px");
        expect(list().style.maxHeight).toBe("240px");
      }));

    it("caps the list to the larger side's room when neither side fits it", () =>
      withViewportHeight(300, async () => {
        const user = userEvent.setup();
        render(<BranchPicker branches={branches} value="main" onChange={() => {}} testIdPrefix="bp" />);
        const toggle = screen.getByTestId("bp-toggle");
        toggle.getBoundingClientRect = () => rect(600, 700, 100, 120);
        await user.click(toggle);
        const pop = screen.getByTestId("bp-popover");
        expect(pop.style.top).toBe("124px");
        expect(parseFloat(list().style.maxHeight)).toBeLessThan(300 - 124 - 8);
      }));

    // The footer sits under the scroll list, so its height (~28px) comes out of the list's room too.
    const footerList = () => screen.getByTestId("bp-footer").previousElementSibling as HTMLElement;

    it("with a footer, flips above when the room below holds the list but not the footer", () =>
      withViewportHeight(800, async () => {
        const user = userEvent.setup();
        render(<BranchPicker branches={branches} value="main" onChange={() => {}} testIdPrefix="bp" footer="Fetched just now" />);
        const toggle = screen.getByTestId("bp-toggle");
        // Room below: 800 − 508 − 4 gap − 8 gutter = 280, enough for list + filter (272) only.
        toggle.getBoundingClientRect = () => rect(600, 700, 488, 508);
        await user.click(toggle);
        const pop = screen.getByTestId("bp-popover");
        expect(pop.style.top).toBe("");
        expect(pop.style.bottom).toBe(`${800 - 488 + 4}px`);
        expect(footerList().style.maxHeight).toBe("240px");
      }));

    it("with a footer, the capped list leaves room for filter and footer inside the viewport", () =>
      withViewportHeight(300, async () => {
        const user = userEvent.setup();
        render(<BranchPicker branches={branches} value="main" onChange={() => {}} testIdPrefix="bp" footer="Fetched just now" />);
        const toggle = screen.getByTestId("bp-toggle");
        toggle.getBoundingClientRect = () => rect(600, 700, 100, 120);
        await user.click(toggle);
        // Room below: 300 − 120 − 4 − 8 = 168, minus a 32px filter row and a 28px footer.
        expect(parseFloat(footerList().style.maxHeight)).toBeLessThanOrEqual(168 - 32 - 28);
      }));

    it("follows the trigger when the layout above it shifts while open", async () => {
      const user = userEvent.setup();
      render(<BranchPicker branches={branches} value="main" onChange={() => {}} testIdPrefix="bp" />);
      const toggle = screen.getByTestId("bp-toggle");
      toggle.getBoundingClientRect = () => rect(600, 700, 40, 60);
      await user.click(toggle);
      expect(screen.getByTestId("bp-popover").style.top).toBe("64px");
      // A banner expands above: no scroll or resize event fires.
      toggle.getBoundingClientRect = () => rect(600, 700, 90, 110);
      await waitFor(() => expect(screen.getByTestId("bp-popover").style.top).toBe("114px"));
    });

    it("a click outside closes it", async () => {
      const user = userEvent.setup();
      render(
        <div>
          <span data-testid="elsewhere">x</span>
          <BranchPicker branches={branches} value="main" onChange={() => {}} testIdPrefix="bp" />
        </div>
      );
      await user.click(screen.getByTestId("bp-toggle"));
      await user.click(screen.getByTestId("elsewhere"));
      expect(screen.queryByTestId("bp-popover")).toBeNull();
    });
  });
  describe("grouped mode", () => {
    const local = ["main", "develop"];
    const remote = [
      { ref: "origin/feat/story-pr-header", remote: "origin", name: "feat/story-pr-header" },
      { ref: "origin/fix/story-index-retry", remote: "origin", name: "fix/story-index-retry" },
      { ref: "origin/kilo/story-lint", remote: "origin", name: "kilo/story-lint" },
      { ref: "upstream/main-next", remote: "upstream", name: "main-next" },
    ];
    const open = async (props: Partial<React.ComponentProps<typeof BranchPicker>> = {}) => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<BranchPicker branches={local} remote={remote} value="main" onChange={onChange} testIdPrefix="bp" {...props} />);
      await user.click(screen.getByTestId("bp-toggle"));
      return { user, onChange };
    };
    const rowsInOrder = () =>
      Array.from(screen.getByTestId("bp-popover").querySelectorAll("[data-testid]"))
        .map((el) => el.getAttribute("data-testid")!)
        .filter((id) => id.startsWith("bp-option-") || id.startsWith("bp-remote-option-") || id.startsWith("bp-group-"));

    it("grouped picker renders Local then Remote · origin headings with counts", async () => {
      await open();
      expect(screen.getByTestId("bp-group-local")).toHaveTextContent("Local");
      expect(screen.getByTestId("bp-group-local-count")).toHaveTextContent("2");
      expect(screen.getByTestId("bp-group-remote-origin")).toHaveTextContent("Remote · origin");
      expect(screen.getByTestId("bp-group-remote-origin-count")).toHaveTextContent("3");
      expect(screen.getByTestId("bp-group-remote-upstream")).toHaveTextContent("Remote · upstream");
      expect(screen.getByTestId("bp-group-remote-upstream-count")).toHaveTextContent("1");
      expect(screen.getByRole("heading", { name: "Local, 2 branches" })).toBe(screen.getByTestId("bp-group-local"));
      expect(screen.getByRole("heading", { name: "Remote · origin, 3 branches" })).toBe(screen.getByTestId("bp-group-remote-origin"));
      expect(screen.getByRole("heading", { name: "Remote · upstream, 1 branch" })).toBe(screen.getByTestId("bp-group-remote-upstream"));
      expect(rowsInOrder()).toEqual([
        "bp-group-local", "bp-group-local-count", "bp-option-main", "bp-option-develop",
        "bp-group-remote-origin", "bp-group-remote-origin-count",
        "bp-remote-option-origin/feat/story-pr-header", "bp-remote-option-origin/fix/story-index-retry", "bp-remote-option-origin/kilo/story-lint",
        "bp-group-remote-upstream", "bp-group-remote-upstream-count", "bp-remote-option-upstream/main-next",
      ]);
    });

    it("grouped picker marks the current local branch", async () => {
      await open();
      const cur = screen.getByTestId("bp-option-main");
      expect(cur).toHaveTextContent("current");
      expect(cur.style.color).toBe("var(--accent)");
      const other = screen.getByTestId("bp-option-develop");
      expect(other).not.toHaveTextContent("current");
      expect(other.style.color).not.toBe("var(--accent)");
    });

    it("grouped picker remote rows read origin/name with a + track hint", async () => {
      await open();
      const row = screen.getByTestId("bp-remote-option-origin/kilo/story-lint");
      expect(row.querySelector(".truncate")).toHaveTextContent(/^origin\/kilo\/story-lint$/);
      expect(row).toHaveTextContent("+ track");
      expect(row).toHaveAttribute("title", "origin/kilo/story-lint");
    });

    it("grouped picker filters both groups and hides empty headings", async () => {
      const { user } = await open();
      await user.type(screen.getByPlaceholderText("Filter branches..."), "story");
      expect(screen.queryByTestId("bp-group-local")).toBeNull();
      expect(screen.queryByTestId("bp-option-main")).toBeNull();
      expect(screen.getByTestId("bp-group-remote-origin-count")).toHaveTextContent("3");
      expect(screen.queryByTestId("bp-group-remote-upstream")).toBeNull();
      await user.clear(screen.getByPlaceholderText("Filter branches..."));
      await user.type(screen.getByPlaceholderText("Filter branches..."), "main");
      expect(screen.getByTestId("bp-group-local-count")).toHaveTextContent("1");
      expect(screen.getByTestId("bp-option-main")).toBeInTheDocument();
      expect(screen.queryByTestId("bp-group-remote-origin")).toBeNull();
      expect(screen.getByTestId("bp-group-remote-upstream-count")).toHaveTextContent("1");
      await user.clear(screen.getByPlaceholderText("Filter branches..."));
      await user.type(screen.getByPlaceholderText("Filter branches..."), "fix");
      expect(screen.queryByTestId("bp-group-local")).toBeNull();
      expect(screen.getByTestId("bp-group-remote-origin-count")).toHaveTextContent(/^1$/);
      expect(screen.getByTestId("bp-remote-option-origin/fix/story-index-retry")).toBeInTheDocument();
      expect(screen.queryByTestId("bp-remote-option-origin/feat/story-pr-header")).toBeNull();
      expect(screen.queryByTestId("bp-group-remote-upstream")).toBeNull();
    });

    it("grouped picker keyboard runs across groups and reports remote picks", async () => {
      const { user, onChange } = await open();
      await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowUp}{ArrowDown}");
      const highlighted = () =>
        Array.from(screen.getByTestId("bp-popover").querySelectorAll<HTMLElement>("[data-testid^='bp-option-'], [data-testid^='bp-remote-option-']"))
          .filter((el) => el.style.background === "var(--bg-hover)")
          .map((el) => el.getAttribute("data-testid"));
      expect(screen.getByTestId("bp-remote-option-origin/fix/story-index-retry").style.background).toBe("var(--bg-hover)");
      expect(highlighted()).toEqual(["bp-remote-option-origin/fix/story-index-retry"]);
      await user.keyboard("{Enter}");
      expect(onChange).toHaveBeenLastCalledWith("origin/fix/story-index-retry", { remote: true });
      await user.click(screen.getByTestId("bp-toggle"));
      await user.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowDown}{Enter}");
      expect(onChange).toHaveBeenLastCalledWith("develop", { remote: false });
      await user.click(screen.getByTestId("bp-toggle"));
      await user.click(screen.getByTestId("bp-remote-option-upstream/main-next"));
      expect(onChange).toHaveBeenLastCalledWith("upstream/main-next", { remote: true });
    });

    it("grouped picker Fetch button shows Fetching while fetching and fetches on open", async () => {
      const onFetch = vi.fn();
      const user = userEvent.setup();
      const { rerender } = render(
        <BranchPicker branches={local} remote={remote} value="main" onChange={() => {}} testIdPrefix="bp" onFetch={onFetch} />
      );
      expect(onFetch).not.toHaveBeenCalled();
      await user.click(screen.getByTestId("bp-toggle"));
      expect(onFetch).toHaveBeenCalledTimes(1);
      const btn = screen.getByTestId("bp-fetch");
      expect(btn).toHaveTextContent("↻ Fetch");
      expect(btn).toBeEnabled();
      expect(btn.parentElement).toBe(screen.getByPlaceholderText("Filter branches...").parentElement);
      expect(btn.parentElement!.lastElementChild).toBe(btn);
      expect(btn.className).toContain("focus-visible:outline-[var(--accent)]");
      await user.click(btn);
      expect(onFetch).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("bp-popover")).toBeInTheDocument();
      rerender(
        <BranchPicker branches={local} remote={remote} value="main" onChange={() => {}} testIdPrefix="bp" onFetch={onFetch} fetching />
      );
      expect(screen.getByTestId("bp-fetch")).toHaveTextContent("Fetching…");
      expect(screen.getByTestId("bp-fetch")).toBeDisabled();
      expect(onFetch).toHaveBeenCalledTimes(2);
    });

    it("grouped picker renders the footer", async () => {
      await open({ footer: "Fetched 12 s ago · a remote branch becomes a local tracking branch" });
      const foot = screen.getByTestId("bp-footer");
      expect(foot).toHaveTextContent("Fetched 12 s ago · a remote branch becomes a local tracking branch");
      expect(screen.getByTestId("bp-popover").lastElementChild).toBe(foot);
    });

    it("grouped picker renders no footer for a null footer", async () => {
      await open({ footer: null });
      expect(screen.queryByTestId("bp-footer")).toBeNull();
    });

    it("flat picker is unchanged without remote", async () => {
      const user = userEvent.setup();
      render(<BranchPicker branches={local} value="main" onChange={() => {}} testIdPrefix="bp" />);
      await user.click(screen.getByTestId("bp-toggle"));
      const pop = screen.getByTestId("bp-popover");
      expect(pop.querySelector("[data-testid^='bp-group-']")).toBeNull();
      expect(screen.queryByTestId("bp-fetch")).toBeNull();
      expect(screen.queryByTestId("bp-footer")).toBeNull();
      const list = pop.lastElementChild as HTMLElement;
      expect(Array.from(list.children).map((c) => c.getAttribute("data-testid"))).toEqual(["bp-option-main", "bp-option-develop"]);
      expect(screen.getByTestId("bp-option-main")).not.toHaveTextContent("current");
      expect(screen.getByTestId("bp-option-main").textContent).toBe("main");
    });
  });
});
