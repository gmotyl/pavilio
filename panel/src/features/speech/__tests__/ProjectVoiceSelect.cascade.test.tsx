/**
 * The project card's voices under the Cascade engine: one voice select per
 * member engine, in Settings' order, each this project's voice for that engine.
 * The project-card check items of the mockup
 * (`projects/pavilio/mockups/2026-10-27-cascade-engine-settings.html`, design.md
 * § Mockups) are asserted one by one; the mockup's *Engine* select is an agreed
 * deviation — the engine stays global, so the card has none.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { listEngines, listVoices } from "anytts";

import { ProjectVoiceSelect } from "../ProjectVoiceSelect";
import ProjectSettingsCard from "../../projects/ProjectSettingsCard";
import {
  catalogDefaultVoice,
  getProjectVoices,
  setCascadeOrder,
  setEngineVoice,
  setStoredEngine,
  voiceFor,
} from "../voices";
import { stubFetch } from "../../../test-utils";

type EngineInfo = {
  id: string;
  label: string;
  keyed: boolean;
  keySource: "env" | "file" | "none";
  status: { state: string };
};

const LABELS = new Map(listEngines().map((engine) => [engine.id, engine.label]));

/** Every member keyed and ready, except the ids in `keyless`. */
function engineList(keyless: readonly string[] = []): EngineInfo[] {
  return ["elevenlabs", "cartesia", "speechify", "azure", "edge"].map((id) => {
    const keyed = id !== "edge";
    const none = keyless.includes(id);
    return {
      id,
      label: LABELS.get(id) ?? id,
      keyed,
      keySource: !keyed || none ? "none" : "file",
      status: { state: none ? "no-key" : "ready" },
    };
  });
}

function labelOf(engine: string, id: string | undefined): string {
  const voice = listVoices(engine).find((v) => v.id === id);
  if (!voice) throw new Error(`unknown ${engine} voice ${id}`);
  return voice.label;
}

function row(id: string): HTMLElement {
  return screen.getByTestId(`project-voice-row-${id}`);
}

function rowIds(): string[] {
  return screen
    .getAllByTestId(/^project-voice-row-/)
    .map((el) => el.getAttribute("data-testid")!.replace("project-voice-row-", ""));
}

function rowSelect(id: string): HTMLSelectElement {
  return within(row(id)).getByRole("combobox") as HTMLSelectElement;
}

/** Renders the card's voice control and waits for the engines list to land. */
async function renderCascade(keyless: readonly string[] = []) {
  const fetchMock = stubFetch({ "/api/speech/engines": engineList(keyless) }, null);
  render(<ProjectVoiceSelect project="p" />);
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/speech/engines"))).toBe(true),
  );
  return fetchMock;
}

beforeEach(() => {
  setStoredEngine("cascade");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ProjectVoiceSelect under the cascade", () => {
  it("cascade lists members with a voice each", async () => {
    setCascadeOrder([
      { id: "edge", on: true },
      { id: "cartesia", on: true },
      { id: "speechify", on: false },
      { id: "elevenlabs", on: true },
      { id: "azure", on: true },
    ]);
    await renderCascade();

    // Settings' order, members only: an engine out of the cascade is not listed.
    expect(rowIds()).toEqual(["edge", "cartesia", "elevenlabs", "azure"]);
    rowIds().forEach((id, index) => {
      const r = row(id);
      expect(within(r).getByTestId("project-voice-position")).toHaveTextContent(String(index + 1));
      expect(r).toHaveTextContent(LABELS.get(id)!);
      // This project's voice for the engine: Default first, then its catalog.
      const select = rowSelect(id);
      expect(select).toHaveAccessibleName(`${LABELS.get(id)} voice for this project`);
      expect(select.value).toBe("");
      const options = within(select).getAllByRole("option") as HTMLOptionElement[];
      expect(options[0]!.textContent).toBe(`Default — ${labelOf(id, catalogDefaultVoice(id))}`);
      expect(options.slice(1).map((o) => o.value).sort()).toEqual(
        listVoices(id).map((v) => v.id).sort(),
      );
    });
    // No single-engine select alongside the list.
    expect(screen.queryByTestId("project-voice-select")).toBeNull();

    const help = screen.getByTestId("project-cascade-help");
    expect(help).toHaveTextContent(/the voice this project uses with that engine on its own/);
    expect(help).toHaveTextContent(/Order is set in Settings → Speech/);
  });

  it("an override is marked and Default restores inheritance", async () => {
    const [george, sarah] = listVoices("elevenlabs").map((v) => v.id);
    setEngineVoice("elevenlabs", george!);
    const user = userEvent.setup();
    await renderCascade();
    expect(screen.queryAllByTestId(/^project-voice-override/)).toHaveLength(0);
    expect(rowSelect("elevenlabs").selectedOptions[0]!.textContent).toBe(
      `Default — ${labelOf("elevenlabs", george)}`,
    );

    await user.selectOptions(rowSelect("elevenlabs"), sarah!);

    expect(getProjectVoices("p")).toEqual({ elevenlabs: sarah });
    expect(rowSelect("elevenlabs").value).toBe(sarah);
    expect(within(row("elevenlabs")).getByTestId("project-voice-override-elevenlabs")).toHaveTextContent(
      `overrides default (${labelOf("elevenlabs", george)})`,
    );
    // Only the overridden member carries the note.
    expect(screen.queryAllByTestId(/^project-voice-override/)).toHaveLength(1);

    await user.selectOptions(rowSelect("elevenlabs"), "");

    expect(getProjectVoices("p")).toEqual({});
    expect(voiceFor("elevenlabs", "p")).toBe(george);
    expect(rowSelect("elevenlabs").value).toBe("");
    expect(screen.queryAllByTestId(/^project-voice-override/)).toHaveLength(0);
  });

  it("a keyless member is greyed and disabled", async () => {
    await renderCascade(["speechify"]);

    await waitFor(() => expect(row("speechify")).toHaveAttribute("data-skipped", "true"));
    expect(row("speechify").style.opacity).toBe("0.62");
    expect(rowSelect("speechify")).toBeDisabled();
    expect(within(row("speechify")).getByTestId("project-voice-skipped")).toHaveTextContent(
      "skipped — no API key",
    );
    // Edge needs no key; a keyed member with one is live.
    for (const id of ["elevenlabs", "edge"]) {
      expect(row(id)).toHaveAttribute("data-skipped", "false");
      expect(rowSelect(id)).toBeEnabled();
      expect(within(row(id)).queryByTestId("project-voice-skipped")).toBeNull();
    }
  });

  it("a failed status fetch greys no member", async () => {
    const fetchMock = stubFetch({ "/api/speech/engines": () => new Response("boom", { status: 500 }) }, null);
    render(<ProjectVoiceSelect project="p" />);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/speech/engines"))).toBe(true),
    );
    // Let the failed answer land before asserting nothing changed.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rowIds().length).toBeGreaterThan(0);
    for (const id of rowIds()) {
      expect(row(id)).toHaveAttribute("data-skipped", "false");
      expect(rowSelect(id)).toBeEnabled();
      expect(within(row(id)).queryByTestId("project-voice-skipped")).toBeNull();
    }
  });

  it("a single engine shows one select", () => {
    setStoredEngine("edge");
    const fetchMock = stubFetch({}, null);
    render(<ProjectVoiceSelect project="p" />);

    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    const select = screen.getByTestId("project-voice-select") as HTMLSelectElement;
    expect(within(select).getAllByRole("option")).toHaveLength(listVoices("edge").length + 1);
    expect(screen.queryByTestId("project-cascade-voices")).toBeNull();
    // Nothing to grey out: today's control asks the server for nothing.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no engine select on the card", async () => {
    for (const engine of ["cascade", "edge"]) {
      setStoredEngine(engine);
      stubFetch({ "/api/speech/engines": engineList() }, null);
      const card = render(<ProjectSettingsCard project="p" />);

      expect(screen.queryByLabelText(/^engine$/i)).toBeNull();
      // No select anywhere on the card offers an engine to pick.
      const engineLabels = new Set(listEngines().map((e) => e.label));
      for (const select of screen.queryAllByRole("combobox")) {
        const options = within(select).queryAllByRole("option") as HTMLOptionElement[];
        expect(options.some((o) => o.value === "cascade" || engineLabels.has(o.textContent ?? ""))).toBe(false);
      }
      card.unmount();
      vi.unstubAllGlobals();
    }
  });

  it("narrow pane fits the member list", async () => {
    let width = 360;
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
    stubFetch({ "/api/speech/engines": engineList() }, null);
    const narrow = render(<ProjectVoiceSelect project="p" />);

    const list = screen.getByTestId("project-cascade-voices");
    expect(list).toHaveAttribute("data-narrow", "true");
    expect(list.style.minWidth).toBe("0px");
    for (const id of rowIds()) {
      // Two columns — position and the rest — with the select on its own line.
      expect(row(id).style.gridTemplateColumns).toBe("22px minmax(0, 1fr)");
      expect(row(id).style.minWidth).toBe("0px");
      expect(rowSelect(id).style.width).toBe("100%");
      expect(rowSelect(id).style.minWidth).toBe("0px");
    }
    narrow.unmount();

    width = 760;
    render(<ProjectVoiceSelect project="p" />);
    expect(screen.getByTestId("project-cascade-voices")).toHaveAttribute("data-narrow", "false");
    for (const id of rowIds()) {
      expect(row(id).style.gridTemplateColumns).toBe("22px minmax(90px, 140px) minmax(0, 1fr)");
    }
  });
});
