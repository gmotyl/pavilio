import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { preferences } from "../declarations";
import { usePreference } from "../usePreference";
import { PREFERENCE_PATCH_DEBOUNCE_MS } from "../store";

/**
 * What `test-setup.ts` has to clean up between tests, proved from the outside.
 *
 * The store is a tab-scoped singleton with a debounced PATCH, and a suite file
 * shares one module graph across its tests. Without the teardown, the write the
 * first test makes here lands mid-way through the second — as a stray request,
 * and as a value still sitting in the injected document. Both were real: a
 * migrated feature suite writes a preference simply by rendering a toggle and
 * clicking it, and never imports the store to clean up after itself.
 */
const fetchMock = vi.fn(
  async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response("{}", { status: 200 }),
);

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

function Probe() {
  const [expanded, setExpanded] = usePreference(preferences.leftSidebarExpanded);
  return (
    <button data-testid="toggle" onClick={() => setExpanded(!expanded)}>
      {String(expanded)}
    </button>
  );
}

const patches = () =>
  fetchMock.mock.calls.filter((call) => String(call[0]).startsWith("/api/preferences"));

const doc = () =>
  (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> }).__PAVILIO_PREFS__!;

describe("a feature suite leaves nothing behind", () => {
  it("queues a preference write and ends the test without flushing it", () => {
    render(<Probe />);
    fireEvent.click(screen.getByTestId("toggle"));

    expect(screen.getByTestId("toggle").textContent).toBe("false");
    expect(doc()[preferences.leftSidebarExpanded.key]).toBe(false);
    // Still on the debounce — this is the pending write the teardown must drop.
    expect(patches()).toHaveLength(0);
  });

  it("does not receive the previous test's pending write", async () => {
    await new Promise((resolve) => setTimeout(resolve, PREFERENCE_PATCH_DEBOUNCE_MS * 3));

    expect(patches()).toHaveLength(0);
    expect(doc()[preferences.leftSidebarExpanded.key]).toBeUndefined();
  });
});
