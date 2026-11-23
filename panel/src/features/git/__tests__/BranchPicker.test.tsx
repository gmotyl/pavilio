import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
