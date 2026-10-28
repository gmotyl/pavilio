/**
 * Settings → Speech: the *Default engine* select and the *Engines and cascade
 * order* list — one row per cascade member, in `speech.cascadeOrder`, with its
 * key, status, voice and switches. The check items of the mockup
 * (`projects/pavilio/mockups/2026-10-27-cascade-engine-settings.html`, design.md
 * § Mockups) are asserted one by one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { listEngines } from "anytts";

import AgentSettings from "../../agents/AgentSettings";
import { EngineSettings } from "../EngineSettings";
import { getCascadeOrder, getStoredVoices, setCascadeOrder } from "../voices";
import { preferences } from "../../../preferences/declarations";
import { readPreference } from "../../../preferences/store";
import { jsonResponse, stubFetch } from "../../../test-utils";

type EngineInfo = {
  id: string;
  label: string;
  keyed: boolean;
  keySource: "env" | "file" | "none";
  keyLast4?: string;
  region?: string;
  status: { state: string; until?: string };
};

const LABELS = new Map(listEngines().map((engine) => [engine.id, engine.label]));

/** What `GET /api/speech/engines` answers in the mockup's state. */
function mockupEngines(): EngineInfo[] {
  return [
    {
      id: "elevenlabs",
      label: "ElevenLabs",
      keyed: true,
      keySource: "file",
      keyLast4: "3f9a",
      status: { state: "ready" },
    },
    {
      id: "cartesia",
      label: "Cartesia",
      keyed: true,
      keySource: "env",
      keyLast4: "77aa",
      status: { state: "quota-exhausted", until: "2026-11-01T12:00:00.000Z" },
    },
    {
      id: "speechify",
      label: "Speechify",
      keyed: true,
      keySource: "none",
      status: { state: "no-key" },
    },
    {
      id: "azure",
      label: "Azure Speech (F0)",
      keyed: true,
      keySource: "file",
      keyLast4: "81c0",
      region: "westeurope",
      status: { state: "unauthorized" },
    },
    { id: "edge", label: "Microsoft Edge (read aloud)", keyed: false, keySource: "none", status: { state: "ready" } },
  ];
}

function row(id: string): HTMLElement {
  return screen.getByTestId(`engine-row-${id}`);
}

function rowIds(): string[] {
  return screen
    .getAllByTestId(/^engine-row-/)
    .map((el) => el.getAttribute("data-testid")!.replace("engine-row-", ""));
}

async function renderLoaded(engines: EngineInfo[] = mockupEngines(), extra = {}) {
  const fetchMock = stubFetch({ "/api/speech/engines": engines, ...extra }, null);
  render(<EngineSettings />);
  // The status chips arrive with the engines list.
  await waitFor(() => expect(within(row("edge")).getByTestId("engine-status")).toHaveTextContent("ready"));
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("EngineSettings", () => {
  it("engine select offers cascade and every engine", async () => {
    stubFetch({ "/api/speech/engines": mockupEngines() }, []);
    render(<AgentSettings />);

    const section = (await screen.findByRole("heading", { level: 2, name: "Speech" })).closest("section")!;
    const select = within(section).getByRole("combobox", { name: "Default engine" }) as HTMLSelectElement;
    const values = Array.from(select.options).map((option) => option.value);
    expect(values).toEqual(expect.arrayContaining(["cascade", "edge", "elevenlabs", "cartesia", "speechify", "azure"]));
    expect(values).toHaveLength(6);
    expect(Array.from(select.options).find((o) => o.value === "cascade")!.textContent).toBe(
      LABELS.get("cascade"),
    );
    // The section carries the engine rows too, and only ONE voice control per
    // engine: the old single "Default voice" select is gone.
    expect(within(section).getByRole("heading", { name: "Engines and cascade order" })).toBeInTheDocument();
    expect(within(section).queryByRole("combobox", { name: "Default voice" })).toBeNull();
    expect(within(section).getAllByRole("combobox", { name: "Voice" })).toHaveLength(5);
  });

  it("rows follow cascade order with move buttons", async () => {
    setCascadeOrder([
      { id: "edge", on: true },
      { id: "azure", on: true },
      { id: "elevenlabs", on: true },
      { id: "cartesia", on: true },
      { id: "speechify", on: true },
    ]);
    await renderLoaded();

    expect(rowIds()).toEqual(["edge", "azure", "elevenlabs", "cartesia", "speechify"]);
    rowIds().forEach((id, index) => {
      expect(within(row(id)).getByTestId("engine-position")).toHaveTextContent(String(index + 1));
    });
    expect(within(row("edge")).queryByRole("button", { name: `Move ${LABELS.get("edge")} up` })).toBeNull();
    expect(within(row("edge")).getByRole("button", { name: `Move ${LABELS.get("edge")} down` })).toBeInTheDocument();
    expect(within(row("speechify")).getByRole("button", { name: `Move ${LABELS.get("speechify")} up` })).toBeInTheDocument();
    expect(within(row("speechify")).queryByRole("button", { name: `Move ${LABELS.get("speechify")} down` })).toBeNull();
    for (const id of ["azure", "elevenlabs", "cartesia"]) {
      expect(within(row(id)).getByRole("button", { name: `Move ${LABELS.get(id)} up` })).toBeInTheDocument();
      expect(within(row(id)).getByRole("button", { name: `Move ${LABELS.get(id)} down` })).toBeInTheDocument();
    }
  });

  it("moving a row saves the order", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    expect(rowIds()).toEqual(["elevenlabs", "cartesia", "speechify", "azure", "edge"]);

    await user.click(within(row("elevenlabs")).getByRole("button", { name: `Move ${LABELS.get("elevenlabs")} down` }));

    expect(rowIds()).toEqual(["cartesia", "elevenlabs", "speechify", "azure", "edge"]);
    expect(readPreference(preferences.speechCascadeOrder).map((entry) => entry.id)).toEqual([
      "cartesia",
      "elevenlabs",
      "speechify",
      "azure",
      "edge",
    ]);
    // The first row now has no ↑, and the moved one does.
    expect(within(row("cartesia")).queryByRole("button", { name: `Move ${LABELS.get("cartesia")} up` })).toBeNull();
    expect(within(row("elevenlabs")).getByRole("button", { name: `Move ${LABELS.get("elevenlabs")} up` })).toBeInTheDocument();
  });

  it("each row shows status, voice, pronunciation and in-cascade", async () => {
    const user = userEvent.setup();
    setCascadeOrder([
      { id: "elevenlabs", on: true },
      { id: "cartesia", on: true },
      { id: "speechify", on: true },
      { id: "azure", on: true },
      { id: "edge", on: true },
    ]);
    await renderLoaded([
      ...mockupEngines().slice(0, 4),
      { ...mockupEngines()[4]!, status: { state: "ready" } },
    ]);

    const chips = Object.fromEntries(
      rowIds().map((id) => [id, within(row(id)).getByTestId("engine-status").textContent]),
    );
    expect(chips).toEqual({
      elevenlabs: "ready",
      cartesia: "quota used · back 1 Nov",
      speechify: "no key · skipped",
      azure: "bad key",
      edge: "ready",
    });

    for (const id of rowIds()) {
      const scope = within(row(id));
      expect(scope.getByText(LABELS.get(id)!)).toBeInTheDocument();
      expect(scope.getByTestId("engine-limit").textContent).not.toBe("");
      expect(scope.getByRole("combobox", { name: "Voice" })).toBeInTheDocument();
      expect(scope.getByRole("checkbox", { name: "Pronunciation map" })).toBeInTheDocument();
      expect(scope.getByRole("checkbox", { name: "In cascade" })).toBeChecked();
    }
    // Pronunciation follows anytts' defaults until switched: Edge on, the others off.
    expect(within(row("edge")).getByRole("checkbox", { name: "Pronunciation map" })).toBeChecked();
    expect(within(row("azure")).getByRole("checkbox", { name: "Pronunciation map" })).not.toBeChecked();

    // Every control writes its own preference.
    const voice = within(row("speechify")).getByRole("combobox", { name: "Voice" }) as HTMLSelectElement;
    const other = Array.from(voice.options).find((o) => o.value !== voice.value)!.value;
    await user.selectOptions(voice, other);
    expect(getStoredVoices().speechify).toBe(other);
    expect(voice).toHaveValue(other);

    await user.click(within(row("azure")).getByRole("checkbox", { name: "Pronunciation map" }));
    expect(readPreference(preferences.speechPronunciationByEngine)).toEqual({ azure: true });

    await user.click(within(row("cartesia")).getByRole("checkbox", { name: "In cascade" }));
    expect(getCascadeOrder().find((entry) => entry.id === "cartesia")!.on).toBe(false);
    expect(within(row("cartesia")).getByRole("checkbox", { name: "In cascade" })).not.toBeChecked();
  });

  it("the last engine in cascade cannot be switched off", async () => {
    setCascadeOrder([
      { id: "elevenlabs", on: false },
      { id: "cartesia", on: false },
      { id: "speechify", on: false },
      { id: "azure", on: false },
      { id: "edge", on: true },
    ]);
    await renderLoaded();

    const last = within(row("edge")).getByRole("checkbox", { name: "In cascade" });
    expect(last).toBeChecked();
    expect(last).toBeDisabled();
    expect(within(row("azure")).getByRole("checkbox", { name: "In cascade" })).toBeEnabled();
  });

  it("key cell shows masked, input or environment", async () => {
    await renderLoaded();

    const file = within(row("elevenlabs"));
    expect(file.getByText("set •••• 3f9a")).toBeInTheDocument();
    expect(file.getByRole("button", { name: `Change ${LABELS.get("elevenlabs")} key` })).toBeInTheDocument();
    expect(file.getByRole("button", { name: `Remove ${LABELS.get("elevenlabs")} key` })).toBeInTheDocument();
    expect(file.queryByLabelText("API key")).toBeNull();

    const none = within(row("speechify"));
    const input = none.getByLabelText("API key") as HTMLInputElement;
    expect(input.type).toBe("password");
    // A fresh secret: the browser must not autofill a saved site password.
    expect(input).toHaveAttribute("autocomplete", "new-password");
    expect(none.getByRole("button", { name: `Save ${LABELS.get("speechify")} key` })).toBeInTheDocument();

    const env = within(row("cartesia"));
    expect(env.getByText("from environment")).toBeInTheDocument();
    expect(env.getByText("CARTESIA_API_KEY")).toBeInTheDocument();
    expect(env.queryByRole("button", { name: /^Save / })).toBeNull();
    expect(env.queryByRole("button", { name: /^Change / })).toBeNull();
    expect(env.queryByRole("button", { name: /^Remove / })).toBeNull();
  });

  it("azure has region and edge has no key cell", async () => {
    await renderLoaded();

    expect(within(row("azure")).getByLabelText("Region")).toHaveValue("westeurope");
    expect(within(row("edge")).queryByTestId("engine-key")).toBeNull();
    expect(within(row("edge")).queryByLabelText("Region")).toBeNull();
    for (const id of ["elevenlabs", "cartesia", "speechify", "azure"]) {
      expect(within(row(id)).getByTestId("engine-key")).toBeInTheDocument();
    }
    for (const id of ["elevenlabs", "cartesia", "speechify"]) {
      expect(within(row(id)).queryByLabelText("Region")).toBeNull();
    }
  });

  it("a keyless row is greyed", async () => {
    await renderLoaded();

    const skipped = row("speechify");
    expect(skipped).toHaveAttribute("data-skipped", "true");
    expect(skipped.style.borderStyle).toBe("dashed");
    expect(Number(skipped.style.opacity)).toBeLessThan(1);
    for (const id of ["elevenlabs", "cartesia", "azure", "edge"]) {
      expect(row(id)).toHaveAttribute("data-skipped", "false");
      expect(row(id).style.borderStyle).not.toBe("dashed");
    }
  });

  it("secrets notice is shown", async () => {
    await renderLoaded();

    const notice = screen.getByTestId("engine-secrets-notice");
    expect(notice).toHaveTextContent("~/.panel/secrets.env");
    expect(notice).toHaveTextContent("outside every repository");
    expect(notice).toHaveTextContent("no restart");
  });

  it("keyed rows carry the overage hint", async () => {
    await renderLoaded();

    for (const id of ["elevenlabs", "cartesia", "speechify", "azure"]) {
      expect(within(row(id)).getByTestId("engine-overage-hint")).toHaveTextContent(/turn off overage billing/i);
    }
    expect(within(row("edge")).queryByTestId("engine-overage-hint")).toBeNull();
  });

  it("narrow pane stacks row cells", async () => {
    let width = 400;
    class MeasuringResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element): void {
        this.callback(
          [{ target, contentRect: { width } } as unknown as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("ResizeObserver", MeasuringResizeObserver);
    stubFetch({ "/api/speech/engines": mockupEngines() }, null);
    const narrow = render(<EngineSettings />);

    const root = screen.getByTestId("engine-settings");
    expect(root).toHaveAttribute("data-narrow", "true");
    for (const body of screen.getAllByTestId("engine-cells")) {
      expect(body.style.gridTemplateColumns).toBe("1fr");
      expect(body.style.minWidth).toBe("0px");
    }
    narrow.unmount();

    width = 760;
    render(<EngineSettings />);
    expect(screen.getByTestId("engine-settings")).toHaveAttribute("data-narrow", "false");
    for (const body of screen.getAllByTestId("engine-cells")) {
      expect(body.style.gridTemplateColumns).toBe("1fr 1fr");
    }
  });

  it("a failed save keeps the old state", async () => {
    const user = userEvent.setup();
    let gets = 0;
    const fetchMock = stubFetch(
      {
        "/api/speech/keys/speechify": () => jsonResponse({ error: "could not save the key" }, { status: 500 }),
        "/api/speech/engines": () => {
          gets += 1;
          return jsonResponse(mockupEngines());
        },
      },
      null,
    );
    render(<EngineSettings />);
    await waitFor(() => expect(within(row("speechify")).getByTestId("engine-status")).toHaveTextContent("no key"));

    await user.type(within(row("speechify")).getByLabelText("API key"), "sk-speechify-secret");
    await user.click(within(row("speechify")).getByRole("button", { name: `Save ${LABELS.get("speechify")} key` }));

    const alert = await within(row("speechify")).findByRole("alert");
    expect(alert).toHaveTextContent("could not save the key");
    expect(within(row("speechify")).getByTestId("engine-status")).toHaveTextContent("no key · skipped");
    expect(within(row("speechify")).getByLabelText("API key")).toHaveValue("sk-speechify-secret");
    expect(row("speechify")).toHaveAttribute("data-skipped", "true");
    const put = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/speech/keys/speechify"))!;
    expect(put[1]!.method).toBe("PUT");
    expect(JSON.parse(String(put[1]!.body))).toEqual({ apiKey: "sk-speechify-secret" });
    // No re-fetch after a failure: the status shown is still the one loaded.
    expect(gets).toBe(1);
  });

  it("a saved key re-fetches the engines", async () => {
    const user = userEvent.setup();
    let saved = false;
    stubFetch(
      {
        "/api/speech/keys/azure": (_url: string, init?: RequestInit) => {
          expect(init!.method).toBe("PUT");
          expect(JSON.parse(String(init!.body))).toEqual({ apiKey: "azure-secret-key-0042", region: "northeurope" });
          saved = true;
          return new Response(null, { status: 204 });
        },
        "/api/speech/engines": () =>
          jsonResponse(
            mockupEngines().map((engine) =>
              saved && engine.id === "azure"
                ? { ...engine, keyLast4: "0042", region: "northeurope", status: { state: "ready" } }
                : engine,
            ),
          ),
      },
      null,
    );
    render(<EngineSettings />);
    await waitFor(() => expect(within(row("azure")).getByTestId("engine-status")).toHaveTextContent("bad key"));

    await user.click(within(row("azure")).getByRole("button", { name: `Change ${LABELS.get("azure")} key` }));
    await user.type(within(row("azure")).getByLabelText("API key"), "azure-secret-key-0042");
    const region = within(row("azure")).getByLabelText("Region");
    await user.clear(region);
    await user.type(region, "northeurope");
    await user.click(within(row("azure")).getByRole("button", { name: `Save ${LABELS.get("azure")} key` }));

    await waitFor(() => expect(within(row("azure")).getByText("set •••• 0042")).toBeInTheDocument());
    expect(within(row("azure")).getByTestId("engine-status")).toHaveTextContent("ready");
    expect(within(row("azure")).queryByLabelText("API key")).toBeNull();
  });

  it("a failed status fetch shows an error with retry", async () => {
    const user = userEvent.setup();
    let up = false;
    stubFetch(
      {
        "/api/speech/engines": () =>
          up ? jsonResponse(mockupEngines()) : jsonResponse({ error: "unauthorized" }, { status: 401 }),
      },
      null,
    );
    render(<EngineSettings />);

    const alert = await screen.findByTestId("engine-status-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent(/could not load engine status/i);
    for (const id of rowIds()) {
      expect(within(row(id)).getByTestId("engine-status")).toHaveTextContent("status unavailable");
      // Unknown is not keyless: no row is greyed on a failed fetch.
      expect(row(id)).toHaveAttribute("data-skipped", "false");
    }

    up = true;
    await user.click(within(alert).getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.queryByTestId("engine-status-error")).toBeNull());
    expect(within(row("elevenlabs")).getByTestId("engine-status")).toHaveTextContent("ready");
    expect(within(row("elevenlabs")).getByText("set •••• 3f9a")).toBeInTheDocument();
  });

  it("key cells stay usable when the status fetch failed", async () => {
    const user = userEvent.setup();
    stubFetch(
      {
        "/api/speech/keys/cartesia": () =>
          jsonResponse({ error: "CARTESIA_API_KEY is set on the server" }, { status: 409 }),
        "/api/speech/engines": () => new Response("boom", { status: 500 }),
      },
      null,
    );
    render(<EngineSettings />);
    await screen.findByTestId("engine-status-error");

    for (const id of ["elevenlabs", "cartesia", "speechify", "azure"]) {
      const scope = within(row(id));
      expect(scope.getByLabelText("API key")).toHaveAttribute("type", "password");
      expect(scope.getByRole("button", { name: `Save ${LABELS.get(id)} key` })).toBeInTheDocument();
    }
    expect(within(row("azure")).getByLabelText("Region")).toBeEnabled();

    await user.type(within(row("cartesia")).getByLabelText("API key"), "sk-cartesia");
    await user.click(within(row("cartesia")).getByRole("button", { name: `Save ${LABELS.get("cartesia")} key` }));

    const error = await within(row("cartesia")).findByRole("alert");
    expect(error).toHaveTextContent("CARTESIA_API_KEY is set on the server");
    expect(within(row("cartesia")).getByLabelText("API key")).toHaveValue("sk-cartesia");
  });
});
