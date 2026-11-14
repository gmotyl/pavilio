/**
 * The answer panel's bottom-edge opacity, as the project settings card offers
 * it: one range input with a percentage readout and no preview (mockup
 * check 7), written to the project's own `answerOpacityBottom`.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { preferences } from "../../../preferences/declarations";
import { readPreference, writePreference } from "../../../preferences/store";
import { useScopedPreference } from "../../../preferences/usePreference";
import ProjectSettingsCard from "../ProjectSettingsCard";

vi.mock("../../speech/ProjectVoiceSelect", () => ({ ProjectVoiceSelect: () => null }));
vi.mock("../AppearanceEditor", () => ({ default: () => null }));

afterEach(cleanup);

const slider = () => screen.getByTestId("project-settings-answer-opacity") as HTMLInputElement;
const readout = () => screen.getByTestId("project-settings-answer-opacity-value");
const row = () => screen.getByTestId("project-settings-answer-opacity-row");

/** Another reader of the same preference — what an open answer pane is. */
function OpacityProbe({ project }: { project: string }) {
  const [value] = useScopedPreference(preferences.answerOpacityBottom, project);
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
        <OpacityProbe project="alpha" />
      </>,
    );
    fireEvent.change(slider(), { target: { value: "40" } });
    expect(readout().textContent).toBe("40%");
    expect(slider().value).toBe("40");
    expect(readPreference(preferences.answerOpacityBottom, "alpha")).toBe(40);
    // Under the project's scope only.
    expect(readPreference(preferences.answerOpacityBottom, "beta")).toBe(100);
    // Every other reader — an open pane — sees it at once.
    expect(screen.getByTestId("opacity-probe").textContent).toBe("40");

    fireEvent.change(slider(), { target: { value: "0" } });
    expect(readout().textContent).toBe("0%");
    expect(readPreference(preferences.answerOpacityBottom, "alpha")).toBe(0);
  });

  it("each project keeps its own opacity", () => {
    act(() => writePreference(preferences.answerOpacityBottom, 40, "alpha"));
    const { rerender } = render(<ProjectSettingsCard project="beta" />);
    expect(slider().value).toBe("100");
    expect(readout().textContent).toBe("100%");

    rerender(<ProjectSettingsCard project="alpha" />);
    expect(slider().value).toBe("40");
    expect(readout().textContent).toBe("40%");

    fireEvent.change(slider(), { target: { value: "65" } });
    rerender(<ProjectSettingsCard project="beta" />);
    expect(slider().value).toBe("100");
    expect(readPreference(preferences.answerOpacityBottom, "alpha")).toBe(65);
    expect(readPreference(preferences.answerOpacityBottom, "beta")).toBe(100);
  });

  it("slider announces its value as a percentage", () => {
    render(<ProjectSettingsCard project="alpha" />);
    expect(slider().getAttribute("aria-valuetext")).toBe("100%");
    fireEvent.change(slider(), { target: { value: "40" } });
    expect(slider().getAttribute("aria-valuetext")).toBe("40%");
  });
});
