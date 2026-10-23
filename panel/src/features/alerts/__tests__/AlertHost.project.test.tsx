import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import AlertHost from "../AlertHost";
import { __resetAlertsForTests, alerts } from "../store";
import { preferences } from "../../../preferences/declarations";
import { __resetPreferenceStoreForTests, writePreference } from "../../../preferences/store";
import { derivedProjectColor } from "../../projects/projectIdentity";
import { __resetProjectColorsForTests } from "../../terminal/useProjectColors";

afterEach(() => {
  cleanup();
  __resetAlertsForTests();
  __resetProjectColorsForTests();
  localStorage.clear();
  __resetPreferenceStoreForTests();
});

describe("AlertHost project identity", () => {
  it("project alert shows edge, tint, coloured name and mark tile", () => {
    writePreference(preferences.projectColor, "#61afef", "metro");
    alerts.info("metro · claude 2", { project: "metro", detail: "Done" });
    render(<AlertHost />);

    const card = screen.getByTestId("alert");
    expect(card.style.borderLeft).toContain("4px");
    expect(card.style.borderLeft).toContain("rgb(97, 175, 239)");
    expect(card.style.background).toContain("color-mix");
    expect(card.style.background).toContain("#61afef");

    const name = within(card).getByTestId("alert-project-name");
    expect(name.textContent).toBe("metro");
    expect(name.style.color).toBe("rgb(97, 175, 239)");

    const title = within(card).getByTestId("alert-title");
    expect(title.textContent).toBe("metro · claude 2");
    const tile = within(card).getByTestId("project-mark");
    expect(tile.getAttribute("data-color")).toBe("#61afef");
    // The tile sits before the text.
    expect(tile.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("alert without a project stays neutral", () => {
    alerts.error("Could not save");
    render(<AlertHost />);
    const card = screen.getByTestId("alert");
    expect(card.style.borderLeft).toContain("3px");
    expect(card.style.background).toBe("var(--bg-surface)");
    expect(within(card).queryByTestId("project-mark")).toBeNull();
    expect(within(card).queryByTestId("alert-project-name")).toBeNull();
  });

  it.each([
    ["claude", "claude · claude 2", ""],
    ["claude", "Speaking — claude · claude 2", "Speaking — "],
    ["Speaking", "Speaking — Speaking · claude 2", "Speaking — "],
    ["speaking", "Speaking — speaking · claude 2", "Speaking — "],
  ])("colours the %s project segment of %j, not an earlier match", (project, title, prefix) => {
    alerts.info(title, { project });
    render(<AlertHost />);
    const el = screen.getByTestId("alert-title");
    const name = within(el).getByTestId("alert-project-name");
    expect(name.textContent).toBe(project);
    expect(el.textContent).toBe(title);
    expect(name.previousSibling?.textContent ?? "").toBe(prefix);
    expect(name.nextSibling?.textContent).toBe(" · claude 2");
  });

  it("uses the derived default colour when none is stored", () => {
    alerts.info("metro · claude 2", { project: "metro" });
    render(<AlertHost />);
    const tile = screen.getByTestId("project-mark");
    const name = screen.getByTestId("alert-project-name");
    expect(tile.getAttribute("data-color")).toBe(derivedProjectColor("metro"));
    expect(name.style.color).not.toBe("");
  });

  it("updates the card when the project colour preference changes", () => {
    writePreference(preferences.projectColor, "#61afef", "metro");
    alerts.info("metro · claude 2", { project: "metro" });
    render(<AlertHost />);
    expect(screen.getByTestId("alert-project-name").style.color).toBe("rgb(97, 175, 239)");
    act(() => writePreference(preferences.projectColor, "#e06c75", "metro"));
    expect(screen.getByTestId("alert-project-name").style.color).toBe("rgb(224, 108, 117)");
    expect(screen.getByTestId("alert").style.borderLeft).toContain("rgb(224, 108, 117)");
  });
});
