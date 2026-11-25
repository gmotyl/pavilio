import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StoryLanguageMenu } from "../StoryLanguageMenu";

describe("StoryLanguageMenu", () => {
  it("language menu lists PL and EN with the current one checked and the footer", () => {
    const onPick = vi.fn();
    render(<StoryLanguageMenu lang="en" onPick={onPick} />);
    const half = screen.getByRole("button", { name: "Story language: English" });
    expect(half).toHaveAttribute("aria-haspopup", "menu");
    expect(half).toHaveAttribute("aria-expanded", "false");
    expect(half).toHaveTextContent("EN ▾");
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(half);
    expect(half).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu", { name: "Story language" });
    expect(within(menu).getByText("Story language")).toBeInTheDocument();
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items.map((i) => i.textContent)).toEqual(["Polski — PL", "English — EN"]);
    expect(items.map((i) => i.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    expect(within(menu).getByText("Applies to every project")).toBeInTheDocument();
    // Opening puts focus on the current choice; arrows move without leaving the menu.
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(items[1], { key: "ArrowDown" });
    expect(items[0]).toHaveFocus();

    fireEvent.click(items[0]);
    expect(onPick).toHaveBeenCalledWith("pl");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(half).toHaveFocus();

    // Escape closes without picking.
    fireEvent.click(half);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("reads PL with the Polish label and stays shut while disabled", () => {
    render(<StoryLanguageMenu lang="pl" onPick={() => {}} disabled />);
    const half = screen.getByRole("button", { name: "Story language: Polish" });
    expect(half).toHaveTextContent("PL ▾");
    expect(half).toBeDisabled();
    fireEvent.click(half);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes an open menu when the half becomes disabled", () => {
    const { rerender } = render(<StoryLanguageMenu lang="en" onPick={() => {}} />);
    const half = screen.getByRole("button", { name: "Story language: English" });
    fireEvent.click(half);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    rerender(<StoryLanguageMenu lang="en" onPick={() => {}} disabled />);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(half).toHaveAttribute("aria-expanded", "false");
    // Re-enabling does not reopen it.
    rerender(<StoryLanguageMenu lang="en" onPick={() => {}} />);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("backdrop click closes the menu and returns focus to the half", () => {
    const onPick = vi.fn();
    const { container } = render(<StoryLanguageMenu lang="en" onPick={onPick} />);
    const half = screen.getByRole("button", { name: "Story language: English" });
    fireEvent.click(half);
    expect(screen.getByRole("menuitemradio", { name: "English — EN" })).toHaveFocus();
    fireEvent.click(container.querySelector(".pr-lang-backdrop") as HTMLElement);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(half).toHaveFocus();
    expect(onPick).not.toHaveBeenCalled();
  });

  describe("menu stays inside its pane", () => {
    const rect = (left: number, right: number) =>
      ({ left, right, top: 0, bottom: 0, width: right - left, height: 0, x: left, y: 0 }) as DOMRect;
    afterEach(() => vi.restoreAllMocks());
    /** Renders the half in a `.prs-view` pane spanning 0–300px, with the right-anchored menu at `menuLeft`. */
    const openIn = (menuLeft: number) => {
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        if (this.classList.contains("prs-view")) return rect(0, 300);
        if (this.classList.contains("pr-lang-menu")) return rect(menuLeft, menuLeft + 190);
        return rect(0, 0);
      });
      render(
        <div className="prs-view">
          <StoryLanguageMenu lang="en" onPick={() => {}} />
        </div>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Story language: English" }));
      return screen.getByRole("menu", { name: "Story language" });
    };

    it("opens leftwards when it fits", () => {
      expect(openIn(60)).not.toHaveAttribute("data-align");
    });

    it("opens rightwards when the pane cuts it off on the left", () => {
      expect(openIn(-40)).toHaveAttribute("data-align", "start");
      const css = readFileSync(resolve("src/features/repos/Prs.css"), "utf8");
      const at = css.indexOf('.pr-lang-menu[data-align="start"] {');
      expect(at).toBeGreaterThanOrEqual(0);
      const body = css.slice(at, css.indexOf("}", at));
      expect(body).toMatch(/left:\s*0/);
      expect(body).toMatch(/right:\s*auto/);
    });
  });
});
