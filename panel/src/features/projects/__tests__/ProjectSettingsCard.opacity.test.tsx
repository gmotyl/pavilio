/**
 * The answer panel's bottom-edge opacity, as the project settings card offers
 * it: one range input with a percentage readout and no preview (mockup
 * check 7), written to the one global `answerOpacityBottom`.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { preferences } from "../../../preferences/declarations";
import { readPreference, writePreference } from "../../../preferences/store";
import { usePreference } from "../../../preferences/usePreference";
import ProjectSettingsCard from "../ProjectSettingsCard";

vi.mock("../../speech/ProjectVoiceSelect", () => ({ ProjectVoiceSelect: () => null }));
vi.mock("../AppearanceEditor", () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  // One global value: put it back so the next test starts solid.
  act(() => writePreference(preferences.answerOpacityBottom, 100));
});

const slider = () => screen.getByTestId("project-settings-answer-opacity") as HTMLInputElement;
const readout = () => screen.getByTestId("project-settings-answer-opacity-value");
const row = () => screen.getByTestId("project-settings-answer-opacity-row");

/** Another reader of the same preference — what an open answer pane is. */
function OpacityProbe() {
  const [value] = usePreference(preferences.answerOpacityBottom);
  return <span data-testid="opacity-probe">{value}</span>;
}

describe("ProjectSettingsCard answer opacity", () => {
  it("settings card shows answer opacity slider with readout and no preview", () => {
    render(<ProjectSettingsCard project="alpha" />);
    const input = screen.getByLabelText("Answer panel opacity (bottom)") as HTMLInputElement;
    expect(input).toBe(slider());
    expect(input.type).toBe("range");
    expect(input.min).toBe("0");
    expect(input.max).toBe("100");
    expect(input.step).toBe("5");
    // Default 100%: today's solid pane.
    expect(input.value).toBe("100");
    expect(readout().textContent).toBe("100%");
    // No preview: the row holds the label, its help line, the slider and the
    // readout — no sample pane, no swatch.
    expect(row().querySelector(".answer-pane")).toBeNull();
    expect(row().querySelector("[data-testid*='preview']")).toBeNull();
    expect(screen.queryByTestId("project-settings-answer-opacity-preview")).toBeNull();
    expect(row().querySelectorAll("input")).toHaveLength(1);
  });

  it("moving the slider writes the project preference and updates the readout", () => {
    render(
      <>
        <ProjectSettingsCard project="alpha" />
        <OpacityProbe />
      </>,
    );
    fireEvent.change(slider(), { target: { value: "40" } });
    expect(readout().textContent).toBe("40%");
    expect(slider().value).toBe("40");
    expect(readPreference(preferences.answerOpacityBottom)).toBe(40);
    // Every other reader — an open pane — sees it at once.
    expect(screen.getByTestId("opacity-probe").textContent).toBe("40");

    fireEvent.change(slider(), { target: { value: "0" } });
    expect(readout().textContent).toBe("0%");
    expect(readPreference(preferences.answerOpacityBottom)).toBe(0);
  });

  it("slider value is shared across projects", () => {
    const { rerender } = render(<ProjectSettingsCard project="motyl" />);
    fireEvent.change(slider(), { target: { value: "40" } });
    rerender(<ProjectSettingsCard project="woozle" />);
    expect(slider().value).toBe("40");
    expect(readout().textContent).toBe("40%");
    expect(readPreference(preferences.answerOpacityBottom)).toBe(40);
  });

  it("slider announces its value as a percentage", () => {
    render(<ProjectSettingsCard project="alpha" />);
    expect(slider().getAttribute("aria-valuetext")).toBe("100%");
    fireEvent.change(slider(), { target: { value: "40" } });
    expect(slider().getAttribute("aria-valuetext")).toBe("40%");
  });
});
