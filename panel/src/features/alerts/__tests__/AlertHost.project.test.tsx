import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import AlertHost from "../AlertHost";
import { __resetAlertsForTests, alerts } from "../store";
import { preferences } from "../../../preferences/declarations";
import { __resetPreferenceStoreForTests, writePreference } from "../../../preferences/store";
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
});
