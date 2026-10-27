import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../host-mode/HostBadge", () => ({ HostBadge: () => null }));

import { Breadcrumbs } from "../Breadcrumbs";
import { preferences } from "../../../preferences/declarations";
import {
  __resetPreferenceStoreForTests,
  writePreference,
} from "../../../preferences/store";
import { __resetProjectColorsForTests } from "../../terminal/useProjectColors";

/** A CSS colour as jsdom serialises it, so a hex and its rgb() compare equal. */
function normalised(color: string): string {
  const probe = document.createElement("span");
  probe.style.color = color;
  return probe.style.color;
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Breadcrumbs />
    </MemoryRouter>,
  );
}

describe("Breadcrumbs project crumb colour", () => {
  beforeEach(() => {
    __resetProjectColorsForTests();
    __resetPreferenceStoreForTests();
    writePreference(preferences.projectColor, "#61afef", "pavilio");
  });

  afterEach(() => {
    cleanup();
    delete document.documentElement.dataset.theme;
    __resetProjectColorsForTests();
    localStorage.clear();
    __resetPreferenceStoreForTests();
  });

  it("breadcrumb project crumb uses the project colour", () => {
    renderAt("/project/pavilio/iterm");
    // A link while a deeper crumb follows it…
    expect(screen.getByRole("link", { name: "pavilio" }).style.color).toBe(
      normalised("#61afef"),
    );
    // …and the section crumb after it stays neutral.
    expect(screen.getByText("iterm").style.color).toBe("var(--text-primary)");

    // Plain text when it is the last crumb.
    cleanup();
    renderAt("/project/pavilio");
    expect(screen.getByText("pavilio").style.color).toBe(normalised("#61afef"));

    // Light theme: the same mix the sidebar names use.
    cleanup();
    document.documentElement.dataset.theme = "light";
    renderAt("/project/pavilio/iterm");
    expect(screen.getByRole("link", { name: "pavilio" }).style.color).toBe(
      normalised("color-mix(in srgb, #61afef 72%, black)"),
    );
  });
});
