import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AgentSettings from "../AgentSettings";
import { preferences } from "../../../preferences/declarations";
import { readPreference, writePreference } from "../../../preferences/store";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The settings page lists agent config files over `fetch`; it needs none here. */
function stubEmptyAgentSettingsApi(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => [] }) as unknown as Response),
  );
}

async function renderSettings(): Promise<HTMLInputElement> {
  stubEmptyAgentSettingsApi();
  render(<AgentSettings />);
  await screen.findByRole("heading", { level: 1, name: "Settings" });
  return screen.getByRole("spinbutton", { name: "Show alerts for" }) as HTMLInputElement;
}

describe("AgentSettings alerts card", () => {
  it("Settings shows an Alerts card with the seconds field defaulting to 15", async () => {
    const field = await renderSettings();

    expect(screen.getByRole("heading", { level: 2, name: "Alerts" })).toBeInTheDocument();
    expect(field.value).toBe("15");
    expect(field).toHaveAttribute("min", "2");
    expect(field).toHaveAttribute("max", "60");
    expect(field).toHaveAttribute("step", "1");
    expect(screen.getByText("seconds")).toBeInTheDocument();
    // The help says which alerts the value covers and which it does not.
    const help = screen.getByTestId("alerts-duration-help");
    expect(help.textContent).toContain("Speaking");
  });

  it("changing the field saves the alert duration preference", async () => {
    const user = userEvent.setup();
    const field = await renderSettings();

    await user.clear(field);
    await user.type(field, "30");
    await user.tab();

    expect(readPreference(preferences.alertsDurationSeconds)).toBe(30);
    expect(field.value).toBe("30");
  });

  it("an out-of-range entry is clamped to 2–60", async () => {
    const user = userEvent.setup();
    writePreference(preferences.alertsDurationSeconds, 15);
    const field = await renderSettings();

    await user.clear(field);
    await user.type(field, "500");
    await user.tab();
    expect(readPreference(preferences.alertsDurationSeconds)).toBe(60);
    expect(field.value).toBe("60");

    await user.clear(field);
    await user.type(field, "1");
    await user.tab();
    expect(readPreference(preferences.alertsDurationSeconds)).toBe(2);
    expect(field.value).toBe("2");
  });

  it("focusing then blurring an untouched field keeps a value synced meanwhile", async () => {
    const user = userEvent.setup();
    writePreference(preferences.alertsDurationSeconds, 15);
    const field = await renderSettings();

    await user.click(field);
    act(() => {
      writePreference(preferences.alertsDurationSeconds, 40);
    });
    await user.tab();
    expect(readPreference(preferences.alertsDurationSeconds)).toBe(40);
    expect(field.value).toBe("40");
  });
});
