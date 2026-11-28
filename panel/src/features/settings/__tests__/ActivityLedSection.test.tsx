/**
 * Settings → "Activity LED": the per-machine `activityLed` preference edited as
 * one object, plus a Test button that asks the server for one sample report.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivityLedSection } from "../ActivityLedSection";
import { preferences } from "../../../preferences/declarations";
import { readPreference } from "../../../preferences/store";

const DEFAULTS = {
  enabled: false,
  host: "192.168.10.156",
  port: 4210,
  colourAttention: "#00FF00",
  colourBusy: "#FF0000",
  brightness: 20,
  blinkMs: 150,
  pauseMs: 2000,
};

function stubFetch() {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
    init?.method === "POST" ? new Response(null, { status: 204 }) : new Response("{}", { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const callsTo = (fetchMock: ReturnType<typeof stubFetch>, url: string) =>
  fetchMock.mock.calls.filter(([u]) => String(u) === url);

const input = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ActivityLedSection", () => {
  it("renders defaults when nothing is saved", () => {
    stubFetch();
    render(<ActivityLedSection />);

    expect(screen.getByRole("heading", { name: "Activity LED" })).toBeTruthy();
    expect(input("Report activity").checked).toBe(false);
    expect(input("Host").value).toBe("192.168.10.156");
    expect(input("Port").value).toBe("4210");
    expect(input("Attention colour").value.toLowerCase()).toBe("#00ff00");
    expect(input("Busy colour").value.toLowerCase()).toBe("#ff0000");
    expect(input("Brightness").value).toBe("20");
    expect(input("Blink (ms)").value).toBe("150");
    expect(input("Pause (ms)").value).toBe("2000");
  });

  it("saves activityLed on field change", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch();
    render(<ActivityLedSection />);

    await user.click(input("Report activity"));
    await user.clear(input("Host"));
    await user.type(input("Host"), "10.0.0.7");
    await user.tab();

    const expected = { ...DEFAULTS, enabled: true, host: "10.0.0.7" };
    expect(readPreference(preferences.activityLed)).toEqual(expected);
    await waitFor(() => {
      const patches = callsTo(fetchMock, "/api/preferences");
      expect(patches.length).toBeGreaterThan(0);
      const last = patches[patches.length - 1];
      expect(last[1]?.method).toBe("PATCH");
      // The whole object travels, not just the changed field.
      expect(JSON.parse(String(last[1]?.body))).toEqual({ activityLed: expected });
    });
  });

  it("Test button posts to the test route", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch();
    render(<ActivityLedSection />);

    await user.click(screen.getByRole("button", { name: "Test" }));

    const calls = callsTo(fetchMock, "/api/activity-led/test");
    expect(calls).toHaveLength(1);
    expect(calls[0][1]?.method).toBe("POST");
  });

  it("numeric inputs carry their bounds", async () => {
    const user = userEvent.setup();
    stubFetch();
    render(<ActivityLedSection />);

    for (const [name, min, max] of [
      ["Brightness", "0", "100"],
      ["Blink (ms)", "50", "1000"],
      ["Pause (ms)", "500", "10000"],
    ] as const) {
      expect(input(name).min, `${name} min`).toBe(min);
      expect(input(name).max, `${name} max`).toBe(max);
    }

    await user.clear(input("Blink (ms)"));
    await user.type(input("Blink (ms)"), "5000");
    await user.tab();
    await user.clear(input("Pause (ms)"));
    await user.type(input("Pause (ms)"), "10");
    await user.tab();
    fireEvent.change(input("Brightness"), { target: { value: "-5" } });

    expect(input("Blink (ms)").value).toBe("1000");
    expect(input("Pause (ms)").value).toBe("500");
    const saved = readPreference(preferences.activityLed);
    expect(saved.blinkMs).toBe(1000);
    expect(saved.pauseMs).toBe(500);
    expect(saved.brightness).toBe(0);
  });
});
