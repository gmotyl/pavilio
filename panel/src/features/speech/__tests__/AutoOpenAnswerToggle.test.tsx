import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AutoOpenAnswerToggle } from "../AutoOpenAnswerToggle";
import { getStoredAutoOpenAnswer, setStoredAutoOpenAnswer } from "../autoOpenAnswer";
import AgentSettings from "../../agents/AgentSettings";
import { preferences } from "../../../preferences/declarations";
import { storageKey } from "../../../preferences/types";

type PrefGlobals = { __PAVILIO_PREFS__?: Record<string, unknown> };
const globals = globalThis as unknown as PrefGlobals;

/** Portable: the workspace document holds it, never browser storage. */
const KEY = storageKey(preferences.answerPaneAutoOpen);

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
    setStoredAutoOpenAnswer(true);
    const stored = render(<AutoOpenAnswerToggle />);
    expect(toggle()).toBeChecked();
    expect(toggle()).toHaveAttribute("id", "speech-auto-open-answer");
    expect(screen.getByTestId("speech-auto-open-answer")).toBe(toggle());
    stored.unmount();
    setStoredAutoOpenAnswer(false);

    // Writes: a click stores the choice; a second click puts it back.
    render(<AutoOpenAnswerToggle />);
    expect(toggle()).not.toBeChecked();

    await user.click(toggle());
    expect(toggle()).toBeChecked();
    expect(globals.__PAVILIO_PREFS__![KEY]).toBe(true);
    expect(localStorage.length).toBe(0);
    expect(getStoredAutoOpenAnswer()).toBe(true);

    await user.click(toggle());
    expect(toggle()).not.toBeChecked();
    expect(getStoredAutoOpenAnswer()).toBe(false);
  });

  it("keeps the choice for this page view when the document never arrived", async () => {
    const user = userEvent.setup();
    // The auth interlock, which replaces the old "site data blocked" case:
    // this page received no preferences document, so the store refuses the
    // write rather than PATCHing a default over the user's real value.
    delete globals.__PAVILIO_PREFS__;

    render(<AutoOpenAnswerToggle />);
    await user.click(toggle());

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
