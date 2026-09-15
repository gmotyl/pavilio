import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AutoOpenAnswerToggle } from "../AutoOpenAnswerToggle";
import { AUTO_OPEN_ANSWER_STORAGE_KEY, getStoredAutoOpenAnswer } from "../autoOpenAnswer";
import AgentSettings from "../../agents/AgentSettings";

const LABEL = "Open the answer pane on a new answer";

/** The settings page lists agent config files over `fetch`; it needs none here. */
function stubEmptyAgentSettingsApi(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => [] }) as unknown as Response),
  );
}

const toggle = (): HTMLInputElement =>
  screen.getByRole("checkbox", { name: LABEL }) as HTMLInputElement;

describe("AutoOpenAnswerToggle", () => {
  it("the Settings toggle reads and writes the default", async () => {
    const user = userEvent.setup();

    // Reads: the stored value is what the box shows.
    localStorage.setItem(AUTO_OPEN_ANSWER_STORAGE_KEY, "1");
    const stored = render(<AutoOpenAnswerToggle />);
    expect(toggle()).toBeChecked();
    expect(toggle()).toHaveAttribute("id", "speech-auto-open-answer");
    expect(screen.getByTestId("speech-auto-open-answer")).toBe(toggle());
    stored.unmount();
    localStorage.clear();

    // Writes: a click stores "1"; a second click removes it.
    render(<AutoOpenAnswerToggle />);
    expect(toggle()).not.toBeChecked();

    await user.click(toggle());
    expect(toggle()).toBeChecked();
    expect(localStorage.getItem(AUTO_OPEN_ANSWER_STORAGE_KEY)).toBe("1");
    expect(getStoredAutoOpenAnswer()).toBe(true);

    await user.click(toggle());
    expect(toggle()).not.toBeChecked();
    expect(getStoredAutoOpenAnswer()).toBe(false);
  });

  it("keeps the choice for this page view when storage throws", async () => {
    const user = userEvent.setup();
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("site data blocked");
    });

    render(<AutoOpenAnswerToggle />);
    await user.click(toggle());

    expect(setItem).toHaveBeenCalled();
    expect(toggle()).toBeChecked();
    expect(getStoredAutoOpenAnswer()).toBe(false);
  });

  it("sits in the Settings page's Speech section, under the voice", async () => {
    stubEmptyAgentSettingsApi();

    render(<AgentSettings />);
    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();

    const heading = screen.getByRole("heading", { level: 2, name: "Speech" });
    const section = heading.closest("section");
    expect(section).not.toBeNull();
    const voice = within(section!).getByRole("combobox", { name: "Speech voice" });
    const box = within(section!).getByRole("checkbox", { name: LABEL });
    // Under the voice: the picker comes first in document order.
    expect(voice.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
