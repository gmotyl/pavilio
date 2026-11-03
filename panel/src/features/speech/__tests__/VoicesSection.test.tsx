/**
 * Settings → Speech → the OpenAI-compatible row's *Voices* section: the OmniVoice server's voices
 * with ▶ and 🗑, and the inline *Add voice* form. One test per check item of the mockup
 * (`projects/pavilio/mockups/2026-11-03-omnivoice-voices-section.html`, design.md § Mockups), with
 * the plan's agreed deviations (bundled/custom counts, delete on custom rows only).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EngineSettings } from "../EngineSettings";
import { VoicesSection } from "../VoicesSection";
import { __resetOpenaiVoicesForTests } from "../useOpenaiVoices";
import type { OmniVoiceInfo } from "../openaiVoices";
import { preferences } from "../../../preferences/declarations";
import { writePreference } from "../../../preferences/store";
import { jsonResponse, stubFetch, type FetchHandler } from "../../../test-utils";
import { EN_MALE, MY_VOICE, OPENAI_VOICES_URL, PL_FEMALE, voicesBody } from "./openaiVoiceFixtures";

const ADDRESS = "http://127.0.0.1:8890";

/** 17 bundled voices: the two fixtures plus 15 more, as the published server ships them. */
const BUNDLED: readonly OmniVoiceInfo[] = [
  PL_FEMALE,
  EN_MALE,
  ...Array.from({ length: 15 }, (_, i) => ({
    id: `narrator-s${i + 10}`,
    label: `Narrator, seed ${i + 10}`,
    locale: "en-GB",
    gender: "male" as const,
    multilingual: false,
    source: "bundled" as const,
  })),
];
const ALL: readonly OmniVoiceInfo[] = [MY_VOICE, ...BUNDLED];

/** Records every `Audio` the section creates, without a media pipeline (jsdom has none). */
class FakeAudio {
  static all: FakeAudio[] = [];
  paused = true;
  onended: (() => void) | null = null;
  constructor(readonly src: string) {
    FakeAudio.all.push(this);
  }
  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

/** A `ResizeObserver` that reports `width` for whatever it observes. */
function measureAt(width: number): void {
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
}

/** Stubs the voice routes: GET answers `list()`, POST and DELETE their own handlers. */
function stubVoices(
  list: () => Response | Promise<Response>,
  handlers: { post?: FetchHandler; del?: FetchHandler } = {},
) {
  return stubFetch(
    {
      [OPENAI_VOICES_URL]: (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (method === "POST" && handlers.post) return handlers.post(url, init);
        if (method === "DELETE" && handlers.del) return handlers.del(url, init);
        return list();
      },
    },
    null,
  );
}

function calls(fetchMock: ReturnType<typeof stubFetch>, method: string) {
  return fetchMock.mock.calls.filter(([, init]) => (init?.method ?? "GET") === method);
}

function voiceRow(id: string): HTMLElement {
  return screen.getByTestId(`voice-row-${id}`);
}

async function renderSection(body: unknown = voicesBody(ALL)) {
  const fetchMock = stubVoices(() => jsonResponse(body));
  render(<VoicesSection address={ADDRESS} />);
  await screen.findByTestId("voice-row-my-voice");
  return fetchMock;
}

/** Fills the add form with a valid new voice. */
async function fillValid(user: ReturnType<typeof userEvent.setup>, name = "new-voice") {
  await user.type(screen.getByLabelText("Name"), name);
  await user.type(screen.getByLabelText("Label"), "New voice");
  await user.upload(screen.getByLabelText("Sample"), new File(["RIFF"], "take.m4a", { type: "audio/mp4" }));
  await user.type(screen.getByLabelText(/Transcript/), "hello there");
}

beforeEach(() => {
  vi.unstubAllGlobals();
  FakeAudio.all = [];
  vi.stubGlobal("Audio", FakeAudio);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __resetOpenaiVoicesForTests();
});

describe("VoicesSection", () => {
  it("renders the section header with bundled and custom counts", async () => {
    const engines = [
      { id: "openai", label: "OpenAI-compatible", keyed: true, keySource: "file", baseUrl: ADDRESS, status: { state: "ready" } },
      { id: "edge", label: "Microsoft Edge", keyed: false, keySource: "none", status: { state: "ready" } },
    ];
    stubFetch({ "/api/speech/engines": engines, [OPENAI_VOICES_URL]: voicesBody(ALL) }, null);
    render(<EngineSettings />);

    const row = screen.getByTestId("engine-row-openai");
    const section = await within(row).findByTestId("voices-section");
    // Inside the row, under the cells, divided off by a top border.
    const cells = within(row).getByTestId("engine-cells");
    expect(cells.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section.style.borderTop).toBe("1px solid var(--border-default)");
    expect(within(section).getByRole("heading", { name: "Voices" })).toBeInTheDocument();
    await waitFor(() => expect(within(section).getByTestId("voices-count")).toHaveTextContent("17 bundled · 1 custom"));
    expect(within(section).getByRole("searchbox", { name: "Filter voices" })).toHaveAttribute("placeholder", "Filter…");
    expect(within(section).getByRole("button", { name: "＋ Add voice" })).toBeEnabled();
    // Only the address engine lists voices.
    expect(within(screen.getByTestId("engine-row-edge")).queryByTestId("voices-section")).toBeNull();
  });

  it("rows show badges and only custom rows have delete", async () => {
    const user = userEvent.setup();
    await renderSection();

    const list = screen.getByTestId("voices-list");
    expect(list.style.maxHeight).toBe("300px");
    expect(list.style.overflowY).toBe("auto");

    const mine = within(voiceRow("my-voice"));
    expect(mine.getByText("My voice")).toBeInTheDocument();
    expect(mine.getByText("my-voice")).toHaveClass("font-mono");
    expect(mine.getByTestId("voice-locale")).toHaveTextContent("pl-PL");
    expect(mine.getByText("male")).toBeInTheDocument();
    expect(mine.getByText("multilingual")).toBeInTheDocument();
    expect(mine.getByText("custom")).toBeInTheDocument();
    // `my-voice` is what OPENAI_VOICE_MAP resolves to: the default badge, in the accent.
    expect(mine.getByText("default").style.color).toBe("var(--accent)");
    expect(mine.getByRole("button", { name: "Delete My voice" })).toBeInTheDocument();

    const bundled = within(voiceRow("pl-female"));
    expect(bundled.getByText("bundled")).toBeInTheDocument();
    expect(bundled.queryByText("multilingual")).toBeNull();
    expect(bundled.queryByText("default")).toBeNull();
    expect(bundled.queryByRole("button", { name: /^Delete/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Delete/ })).toHaveLength(1);

    // The filter narrows the list by label or name.
    await user.type(screen.getByRole("searchbox", { name: "Filter voices" }), "polish");
    expect(screen.queryByTestId("voice-row-my-voice")).toBeNull();
    expect(screen.getByTestId("voice-row-pl-female")).toBeInTheDocument();
    expect(screen.getByTestId("voices-section")).toHaveAttribute("data-compact", "false");

    // Below 480 px the locale is hidden.
    cleanup();
    measureAt(390);
    render(<VoicesSection address={ADDRESS} />);
    expect(await screen.findByTestId("voice-row-my-voice")).toBeInTheDocument();
    expect(screen.getByTestId("voices-section")).toHaveAttribute("data-compact", "true");
    expect(screen.queryAllByTestId("voice-locale")).toHaveLength(0);
    expect(within(voiceRow("my-voice")).getByText("male")).toBeInTheDocument();
    // In a narrow pane the badges wrap inside a column capped at half the row, so the label
    // keeps its width and 🗑 stays inside the list (no horizontal scroll in the list).
    expect(voiceRow("my-voice").style.gridTemplateColumns).toBe("26px minmax(0, 1fr) fit-content(50%) 26px");
    const meta = within(voiceRow("my-voice")).getByTestId("voice-meta");
    expect(meta).toHaveClass("flex-wrap", "justify-end");
    expect(meta).toHaveTextContent("custom");
  });

  it("play toggles one sample at a time", async () => {
    const user = userEvent.setup();
    await renderSection();

    await user.click(within(voiceRow("my-voice")).getByRole("button", { name: "Play sample of My voice" }));
    expect(FakeAudio.all).toHaveLength(1);
    expect(FakeAudio.all[0]!.src).toBe("/api/speech/openai/voices/my-voice/sample");
    expect(FakeAudio.all[0]!.paused).toBe(false);
    expect(voiceRow("my-voice")).toHaveAttribute("data-playing", "true");
    expect(voiceRow("my-voice").style.background).toBe("var(--bg-active)");
    expect(within(voiceRow("my-voice")).getByRole("button", { name: "Stop sample of My voice" })).toHaveTextContent("■");

    // Another ▶ stops the first sample.
    await user.click(within(voiceRow("pl-female")).getByRole("button", { name: "Play sample of Polish female" }));
    expect(FakeAudio.all[0]!.paused).toBe(true);
    expect(FakeAudio.all[1]!.paused).toBe(false);
    expect(voiceRow("my-voice")).toHaveAttribute("data-playing", "false");
    expect(within(voiceRow("my-voice")).getByRole("button", { name: "Play sample of My voice" })).toHaveTextContent("▶");
    expect(voiceRow("pl-female")).toHaveAttribute("data-playing", "true");

    // ■ stops it; a sample that ends on its own clears the row too.
    await user.click(within(voiceRow("pl-female")).getByRole("button", { name: "Stop sample of Polish female" }));
    expect(FakeAudio.all[1]!.paused).toBe(true);
    expect(screen.queryAllByTestId(/^voice-row-/).filter((el) => el.dataset.playing === "true")).toHaveLength(0);
    await user.click(within(voiceRow("en-male")).getByRole("button", { name: "Play sample of English male" }));
    act(() => FakeAudio.all[2]!.onended?.());
    expect(voiceRow("en-male")).toHaveAttribute("data-playing", "false");
  });

  it("add form opens inline with all fields", async () => {
    const user = userEvent.setup();
    await renderSection();

    await user.click(screen.getByRole("button", { name: "＋ Add voice" }));
    const form = screen.getByRole("group", { name: "Add voice" });
    expect(screen.getByTestId("voices-section")).toContainElement(form);
    expect(screen.queryByRole("dialog")).toBeNull();

    expect(within(form).getByLabelText("Name")).toBeInTheDocument();
    expect(within(form).getByText(/lowercase letters, digits, dashes/)).toBeInTheDocument();
    expect(within(form).getByLabelText("Label")).toBeInTheDocument();
    expect(within(form).getByLabelText("Sample")).toHaveAttribute("type", "file");
    expect(within(form).getByRole("button", { name: "Choose file…" })).toBeInTheDocument();
    expect(within(form).getByText(/Any audio format.*8–10 s clones best/)).toBeInTheDocument();
    expect(within(form).getByLabelText("Transcript — exactly what is said in the sample").tagName).toBe("TEXTAREA");
    expect(within(form).getByLabelText("Locale")).toHaveValue("pl-PL");
    expect(within(form).getByLabelText("Gender")).toHaveValue("male");
    expect(within(form).getByRole("checkbox", { name: /Multilingual/ })).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "Add voice" })).toBeInTheDocument();

    await user.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Add voice" })).toBeNull();
  });

  it("existing custom name switches to replace, bundled name is a field error", async () => {
    const user = userEvent.setup();
    const fetchMock = await renderSection();
    await user.click(screen.getByRole("button", { name: "＋ Add voice" }));

    await user.type(screen.getByLabelText("Name"), "my-voice");
    expect(screen.getByText("⚠ “my-voice” exists — saving replaces it")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace voice" })).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Name"));
    await user.upload(screen.getByLabelText("Sample"), new File(["RIFF"], "take.wav", { type: "audio/wav" }));
    await user.type(screen.getByLabelText(/Transcript/), "hello there");
    await user.type(screen.getByLabelText("Name"), "pl-female");
    expect(screen.queryByText(/exists — saving replaces it/)).toBeNull();
    expect(screen.getByText(/“pl-female” is a bundled voice/)).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    await user.click(screen.getByRole("button", { name: "Add voice" }));
    expect(calls(fetchMock, "POST")).toHaveLength(0);
  });

  it("submitting locks the form and closes on success", async () => {
    const user = userEvent.setup();
    let list = voicesBody(ALL);
    let answer: (res: Response) => void = () => {};
    const fetchMock = stubVoices(() => jsonResponse(list), {
      post: () => new Promise<Response>((resolve) => (answer = resolve)),
    });
    render(<VoicesSection address={ADDRESS} />);
    await screen.findByTestId("voice-row-my-voice");

    await user.click(screen.getByRole("button", { name: "＋ Add voice" }));
    await fillValid(user);
    await user.selectOptions(screen.getByLabelText("Locale"), "en-GB");
    await user.selectOptions(screen.getByLabelText("Gender"), "female");
    await user.click(screen.getByRole("checkbox", { name: /Multilingual/ }));
    await user.click(screen.getByRole("button", { name: "Add voice" }));

    expect(await screen.findByText("Cloning on the OmniVoice server…")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByLabelText(/Transcript/)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Adding…" })).toBeDisabled();

    const posts = calls(fetchMock, "POST");
    expect(posts).toHaveLength(1);
    expect(String(posts[0]![0])).toBe(OPENAI_VOICES_URL);
    const sent = posts[0]![1]!.body as FormData;
    expect(sent.get("name")).toBe("new-voice");
    expect(sent.get("label")).toBe("New voice");
    expect(sent.get("ref_text")).toBe("hello there");
    expect(sent.get("locale")).toBe("en-GB");
    expect(sent.get("gender")).toBe("female");
    expect(sent.get("multilingual")).toBe("true");
    expect((sent.get("file") as File).name).toBe("take.m4a");

    const added: OmniVoiceInfo = { id: "new-voice", label: "New voice", locale: "en-GB", gender: "female", multilingual: true, source: "custom" };
    list = voicesBody([...ALL, added]);
    await act(async () => answer(jsonResponse({ id: "new-voice" }, { status: 201 })));

    await waitFor(() => expect(screen.queryByRole("group", { name: "Add voice" })).toBeNull());
    expect(await screen.findByTestId("voice-row-new-voice")).toBeInTheDocument();
    expect(screen.getByTestId("voices-count")).toHaveTextContent("17 bundled · 2 custom");
  });

  it("field errors block the upload", async () => {
    const user = userEvent.setup();
    const fetchMock = await renderSection();
    await user.click(screen.getByRole("button", { name: "＋ Add voice" }));

    await user.type(screen.getByLabelText("Name"), "My Voice!");
    await user.click(screen.getByRole("button", { name: "Add voice" }));

    expect(screen.getByText("Use lowercase letters, digits and dashes — e.g. my-voice.")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Choose a sample recording.")).toBeInTheDocument();
    expect(screen.getByText(/The transcript is required/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Transcript/)).toHaveAttribute("aria-invalid", "true");
    // The button stays enabled so the fix can be retried.
    expect(screen.getByRole("button", { name: "Add voice" })).toBeEnabled();
    expect(calls(fetchMock, "POST")).toHaveLength(0);
  });

  it("unreachable server shows the banner and disables add; server 400 detail shows in the banner", async () => {
    const user = userEvent.setup();
    let down = true;
    const fetchMock = stubVoices(
      () => (down ? jsonResponse({ error: "unreachable" }, { status: 502 }) : jsonResponse(voicesBody(ALL))),
      { post: () => jsonResponse({ error: "upstream", detail: "ffmpeg could not decode the file" }, { status: 400 }) },
    );
    render(<VoicesSection address={ADDRESS} />);

    const banner = await screen.findByTestId("voices-unreachable");
    expect(banner).toHaveTextContent(ADDRESS);
    expect(banner).toHaveTextContent("omnivoicectl start");
    expect(banner.style.color).toBe("var(--red)");
    expect(screen.getByRole("button", { name: "＋ Add voice" })).toBeDisabled();

    down = false;
    await user.click(within(banner).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByTestId("voices-unreachable")).toBeNull());
    expect(calls(fetchMock, "GET").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("button", { name: "＋ Add voice" })).toBeEnabled();

    // A clone that fails on the server: its detail in the red banner, the fields kept.
    await user.click(screen.getByRole("button", { name: "＋ Add voice" }));
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Add voice" }));
    const error = await screen.findByTestId("voices-error");
    expect(error).toHaveTextContent("ffmpeg could not decode the file");
    expect(error.style.color).toBe("var(--red)");
    expect(screen.getByRole("group", { name: "Add voice" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("new-voice");
    expect(screen.getByLabelText(/Transcript/)).toHaveValue("hello there");
    expect(screen.getByLabelText("Name")).toBeEnabled();
  });

  it("no custom voices shows the empty line with the install hint", async () => {
    stubVoices(() => jsonResponse(voicesBody(BUNDLED, 2)));
    const { unmount } = render(<VoicesSection address={ADDRESS} />);

    const empty = await screen.findByTestId("voices-empty");
    expect(empty).toHaveTextContent("No custom voices on this server yet");
    expect(empty).toHaveTextContent("2 voices are saved in this workspace — run pnpm install:speech");
    expect(within(empty).getByText("pnpm install:speech").tagName).toBe("CODE");
    // The bundled rows come first; the line closes the list.
    const list = screen.getByTestId("voices-list");
    expect(within(list).getAllByTestId(/^voice-row-/)).toHaveLength(17);
    expect(list.lastElementChild).toBe(empty);
    unmount();
    __resetOpenaiVoicesForTests();

    stubVoices(() => jsonResponse(voicesBody(BUNDLED, 0)));
    render(<VoicesSection address={ADDRESS} />);
    const plain = await screen.findByTestId("voices-empty");
    expect(plain).toHaveTextContent("No custom voices on this server yet");
    expect(plain).not.toHaveTextContent("install:speech");
  });

  it("delete confirm names uses and deletes", async () => {
    const user = userEvent.setup();
    act(() => {
      writePreference(preferences.speechVoice, { edge: "pl-PL-ZofiaNeural", openai: "my-voice" });
      writePreference(preferences.speechVoiceByProject, {
        "motyl-dev": { openai: "my-voice" },
        gitara: { openai: "pl-female" },
      });
    });
    let list = voicesBody(ALL);
    const fetchMock = stubVoices(() => jsonResponse(list), {
      del: () => {
        list = voicesBody(BUNDLED);
        return new Response(null, { status: 204 });
      },
    });
    render(<VoicesSection address={ADDRESS} />);
    await screen.findByTestId("voice-row-my-voice");

    await user.click(screen.getByRole("button", { name: "Delete My voice" }));
    const bar = within(voiceRow("my-voice")).getByTestId("voice-confirm");
    expect(bar).toHaveTextContent("Delete “My voice”?");
    expect(bar).toHaveTextContent("It is the voice in Settings and in project motyl-dev — that falls back to the default.");
    expect(bar).not.toHaveTextContent("gitara");

    // Cancel puts the row back.
    await user.click(within(bar).getByRole("button", { name: "Cancel" }));
    expect(within(voiceRow("my-voice")).queryByTestId("voice-confirm")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Delete My voice" }));
    await user.click(within(voiceRow("my-voice")).getByRole("button", { name: "Delete" }));
    const dels = calls(fetchMock, "DELETE");
    expect(dels).toHaveLength(1);
    expect(String(dels[0]![0])).toBe("/api/speech/openai/voices/my-voice");
    await waitFor(() => expect(screen.queryByTestId("voice-row-my-voice")).toBeNull());
  });

  it("a server refusal shows directly above the open add form, not above the list", async () => {
    const user = userEvent.setup();
    stubVoices(() => jsonResponse(voicesBody(ALL)), {
      post: () => jsonResponse({ error: "upstream", detail: "ffmpeg could not decode the file" }, { status: 400 }),
    });
    render(<VoicesSection address={ADDRESS} />);
    await screen.findByTestId("voice-row-my-voice");

    await user.click(screen.getByRole("button", { name: "＋ Add voice" }));
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Add voice" }));
    const error = await screen.findByTestId("voices-error");
    const form = screen.getByRole("group", { name: "Add voice" });
    // Below the 300 px list, right on top of the form the user is looking at.
    expect(screen.getByTestId("voices-list").compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(error.nextElementSibling).toBe(form);
  });

  it("the delete confirm takes focus, is announced, and Cancel gives focus back to 🗑", async () => {
    const user = userEvent.setup();
    await renderSection();

    await user.click(screen.getByRole("button", { name: "Delete My voice" }));
    const bar = within(voiceRow("my-voice")).getByTestId("voice-confirm");
    expect(within(bar).getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(within(bar).getByRole("alert")).toHaveTextContent("Delete “My voice”?");

    await user.click(within(bar).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Delete My voice" })).toHaveFocus();
  });

  it("a delete refusal clears when the confirm is cancelled or the add form opens", async () => {
    const user = userEvent.setup();
    stubVoices(() => jsonResponse(voicesBody(ALL)), {
      del: () => jsonResponse({ error: "upstream", detail: "voice is busy" }, { status: 400 }),
    });
    render(<VoicesSection address={ADDRESS} />);
    await screen.findByTestId("voice-row-my-voice");

    await user.click(screen.getByRole("button", { name: "Delete My voice" }));
    await user.click(within(voiceRow("my-voice")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByTestId("voices-error")).toHaveTextContent("voice is busy");
    await user.click(within(voiceRow("my-voice")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("voices-error")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Delete My voice" }));
    await user.click(within(voiceRow("my-voice")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByTestId("voices-error")).toHaveTextContent("voice is busy");
    await user.click(screen.getByRole("button", { name: "＋ Add voice" }));
    expect(screen.queryByTestId("voices-error")).toBeNull();
  });

  it("before the first answer lands it shows a quiet loading line, not the empty state", async () => {
    stubVoices(() => new Promise<Response>(() => {}));
    render(<VoicesSection address={ADDRESS} />);

    expect(await screen.findByTestId("voices-loading")).toHaveTextContent("Loading voices…");
    expect(screen.queryByTestId("voices-empty")).toBeNull();
    expect(screen.queryByText(/No custom voices/)).toBeNull();
  });

  it("a failed first load shows a Retry banner, not a loading line forever", async () => {
    const user = userEvent.setup();
    let fail = true;
    stubVoices(() => (fail ? Promise.reject(new TypeError("Failed to fetch")) : jsonResponse(voicesBody(ALL))));
    render(<VoicesSection address={ADDRESS} />);

    const banner = await screen.findByTestId("voices-failed");
    expect(screen.queryByTestId("voices-loading")).toBeNull();
    expect(screen.queryByTestId("voices-empty")).toBeNull();

    fail = false;
    await user.click(within(banner).getByRole("button", { name: "Retry" }));
    await screen.findByTestId("voice-row-my-voice");
    expect(screen.queryByTestId("voices-failed")).toBeNull();
  });

  it("the hidden file input is not a tab stop; Choose file… is", async () => {
    const user = userEvent.setup();
    await renderSection();
    await user.click(screen.getByRole("button", { name: "＋ Add voice" }));

    expect(screen.getByLabelText("Sample")).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("button", { name: "Choose file…" })).not.toHaveAttribute("tabindex");
  });

  it("unmounting pauses the playing sample", async () => {
    const user = userEvent.setup();
    stubVoices(() => jsonResponse(voicesBody(ALL)));
    const { unmount } = render(<VoicesSection address={ADDRESS} />);
    await screen.findByTestId("voice-row-my-voice");

    await user.click(within(voiceRow("my-voice")).getByRole("button", { name: "Play sample of My voice" }));
    expect(FakeAudio.all[0]!.paused).toBe(false);
    unmount();
    expect(FakeAudio.all[0]!.paused).toBe(true);
  });

  it("submitting in Replace mode sends the POST and closes the form", async () => {
    const user = userEvent.setup();
    const fetchMock = stubVoices(() => jsonResponse(voicesBody(ALL)), {
      post: () => jsonResponse({ id: "my-voice" }, { status: 201 }),
    });
    render(<VoicesSection address={ADDRESS} />);
    await screen.findByTestId("voice-row-my-voice");

    await user.click(screen.getByRole("button", { name: "＋ Add voice" }));
    await fillValid(user, "my-voice");
    expect(screen.getByText("⚠ “my-voice” exists — saving replaces it")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Replace voice" }));

    await waitFor(() => expect(screen.queryByRole("group", { name: "Add voice" })).toBeNull());
    const posts = calls(fetchMock, "POST");
    expect(posts).toHaveLength(1);
    expect((posts[0]![1]!.body as FormData).get("name")).toBe("my-voice");
    expect(screen.getByTestId("voice-row-my-voice")).toBeInTheDocument();
  });
});
