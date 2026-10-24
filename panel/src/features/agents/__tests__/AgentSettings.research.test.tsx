import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AgentSettings from "../AgentSettings";
import { preferences } from "../../../preferences/declarations";
import { readPreference } from "../../../preferences/store";
import { stubFetch } from "../../../test-utils";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderSettings(): Promise<HTMLInputElement> {
  stubFetch({}, []);
  render(<AgentSettings />);
  await screen.findByRole("heading", { level: 1, name: "Settings" });
  return screen.getByRole("textbox", { name: "Spikes root" }) as HTMLInputElement;
}

describe("AgentSettings research section", () => {
  it("Settings research section saves the spikes root", async () => {
    const user = userEvent.setup();
    const field = await renderSettings();

    expect(screen.getByRole("heading", { level: 2, name: "Research" })).toBeInTheDocument();
    expect(field.value).toBe("~/git/prv/spikes");

    await user.clear(field);
    await user.type(field, "  ~/code/spikes ");
    await user.tab();
    expect(readPreference(preferences.researchSpikesRoot)).toBe("~/code/spikes");
    expect(field.value).toBe("~/code/spikes");

    // A blank root names nothing, so it falls back to the default.
    await user.clear(field);
    await user.tab();
    expect(readPreference(preferences.researchSpikesRoot)).toBe("~/git/prv/spikes");
    expect(field.value).toBe("~/git/prv/spikes");
  });
});
