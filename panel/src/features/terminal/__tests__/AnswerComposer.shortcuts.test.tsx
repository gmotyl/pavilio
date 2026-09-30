/**
 * The composer shortcut chips: one chip per `preferences.composerShortcuts`
 * entry, in the chip row between the `/ skills` chip and any pasted-image
 * chips. A press sends the shortcut's text and then Enter through the same
 * `submitToPty` path as the send button, verbatim, and never touches the draft.
 *
 * The pool is mocked the way `AnswerComposer.pendingRow.test.tsx` mocks it, so
 * the connection state the chips are disabled by can be set by hand.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { preferences, type ComposerShortcut } from "../../../preferences/declarations";
import {
  __resetPreferenceStoreForTests,
  clearPreference,
  writePreference,
} from "../../../preferences/store";
import { AnswerComposer } from "../AnswerComposer";
import type { SkillEntry } from "../commandSource";
import { __resetComposerDraftsForTests, getDraft } from "../composerDrafts";
import { __resetPtySubmitForTests } from "../ptySubmit";
import type { ConnectionState } from "../terminalInstances";

let connectionState: ConnectionState = "connected";
const listeners = new Map<string, Set<(state: ConnectionState) => void>>();

vi.mock("../terminalInstances", () => ({
  sendDismiss: () => {},
  reconnectOnActivate: () => {},
  getConnectionState: () => connectionState,
  hasExited: () => false,
  reconnectSession: () => {},
  onConnectionChange: (sessionId: string, cb: (state: ConnectionState) => void) => {
    let set = listeners.get(sessionId);
    if (!set) {
      set = new Set();
      listeners.set(sessionId, set);
    }
    set.add(cb);
    return () => {
      set?.delete(cb);
    };
  },
}));

const SESSION = "cell-a";

const SKILLS: SkillEntry[] = [
  { name: "pavilio-grill", description: "Stress-test an idea", path: "skills/pavilio-grill/SKILL.md" },
];

const send = vi.fn((_data: string) => true);
const onSubmitted = vi.fn();

const fetchFn = vi.fn((url: string) => {
  const body = String(url).includes("/api/skills") ? SKILLS : { path: "/tmp/pavilio-pastes/shot.png" };
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
});

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function installMatchMedia(): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

function withShortcuts(list: ComposerShortcut[]): void {
  writePreference(preferences.composerShortcuts, list);
}

function renderComposer() {
  return render(<AnswerComposer sessionId={SESSION} send={send} onSubmitted={onSubmitted} />);
}

const field = (): HTMLTextAreaElement =>
  screen.getByTestId(`answer-pane-composer-${SESSION}`) as HTMLTextAreaElement;

const shortcut = (index: number): HTMLButtonElement =>
  screen.getByTestId(`answer-pane-shortcut-${index}-${SESSION}`) as HTMLButtonElement;

/** The composer's own load of the known names has answered. */
async function skillsLoaded(): Promise<void> {
  await waitFor(() => expect(fetchFn).toHaveBeenCalledWith("/api/skills"));
  await Promise.resolve();
  await Promise.resolve();
}

// `src/features/terminal/__tests__` → `src/index.css`, comments stripped so a
// comment in front of a rule is never read as part of its selector.
const css = readFileSync(join(__dirname, "..", "..", "..", "index.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** The body of every `@media (max-width: 767px)` block, concatenated. */
function touchBlocks(): string {
  const out: string[] = [];
  const marker = "@media (max-width: 767px)";
  let at = css.indexOf(marker);
  while (at !== -1) {
    const open = css.indexOf("{", at);
    let depth = 1;
    let i = open + 1;
    while (depth > 0 && i < css.length) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") depth -= 1;
      i += 1;
    }
    out.push(css.slice(open + 1, i - 1));
    at = css.indexOf(marker, i);
  }
  return out.join("\n");
}

/** The declarations one exact selector gets within `source`, in cascade order. */
function declarationsOf(source: string, selector: string): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [, selectorList, body] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(",").some((one) => one.trim() === selector)) continue;
    for (const declaration of body.split(";")) {
      const colon = declaration.indexOf(":");
      if (colon === -1) continue;
      merged[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
    }
  }
  return merged;
}

beforeEach(() => {
  connectionState = "connected";
  listeners.clear();
  send.mockClear();
  onSubmitted.mockClear();
  fetchFn.mockClear();
  __resetPtySubmitForTests();
  __resetComposerDraftsForTests();
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  vi.stubGlobal("fetch", fetchFn);
  installMatchMedia();
});

afterEach(() => {
  clearPreference(preferences.composerShortcuts);
  __resetPreferenceStoreForTests();
  vi.unstubAllGlobals();
});

describe("AnswerComposer shortcut chips", () => {
  it("the chip row orders skills, shortcuts, then images", async () => {
    withShortcuts([
      { label: "Yes", text: "yes" },
      { label: "OK", text: "ok" },
      { label: "Go on", text: "go on" },
    ]);
    renderComposer();

    await userEvent.setup().click(field());
    const image = new File(["x"], "shot.png", { type: "image/png" });
    fireEvent.paste(field(), {
      clipboardData: {
        items: [{ kind: "file", type: image.type, getAsFile: () => image }],
        getData: () => "",
      },
    });
    const attachment = await screen.findByTestId(`answer-pane-attachment-${SESSION}-0`);

    const row = attachment.parentElement as HTMLElement;
    expect(row).toHaveClass("answer-pane-composer-chips");
    const labels = Array.from(row.children).map((chip) => chip.textContent?.trim());
    expect(labels).toEqual(["/ skills", "Yes", "OK", "Go on", "shot.png"]);

    // Each chip is named by its label, and its tooltip carries what it sends.
    const go = within(row).getByRole("button", { name: "Go on" });
    expect(go).toBe(shortcut(2));
    expect(go.title).toBe("Go on — sends “go on”");
  });

  it("a shortcut sends its text and Enter", async () => {
    withShortcuts([
      { label: "Yes", text: "yes" },
      { label: "OK", text: "ok" },
    ]);
    const user = userEvent.setup();
    renderComposer();

    await user.click(screen.getByRole("button", { name: "Yes" }));

    // The body, then the submitting return on a turn of its own — exactly what
    // the send button writes.
    await waitFor(() => expect(send.mock.calls).toEqual([["yes"], ["\r"]]));
    // The same handover the send button makes: the pane is told a reply went.
    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });

  it("a shortcut leaves the draft alone", async () => {
    withShortcuts([{ label: "Yes", text: "yes" }]);
    const user = userEvent.setup();
    renderComposer();

    await user.click(field());
    await user.keyboard("half a thought");
    await user.click(shortcut(0));

    await waitFor(() => expect(send.mock.calls).toEqual([["yes"], ["\r"]]));
    expect(field().value).toBe("half a thought");
    expect(getDraft(SESSION)).toBe("half a thought");
    // The press never took the focus off the field.
    expect(document.activeElement).toBe(field());
  });

  it("a shortcut leaves an open picker and its token alone", async () => {
    withShortcuts([{ label: "Yes", text: "yes" }]);
    const user = userEvent.setup();
    renderComposer();

    await user.click(field());
    await user.keyboard("/gri");
    await screen.findByRole("listbox");
    await user.click(shortcut(0));

    await waitFor(() => expect(send.mock.calls).toEqual([["yes"], ["\r"]]));
    // The picker is about the draft, and the draft did not change.
    expect(field().value).toBe("/gri");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("a shortcut is never expanded as a skill", async () => {
    withShortcuts([{ label: "Grill", text: "/pavilio-grill" }]);
    const user = userEvent.setup();
    renderComposer();
    await skillsLoaded();

    await user.click(shortcut(0));

    await waitFor(() => expect(send.mock.calls).toEqual([["/pavilio-grill"], ["\r"]]));
  });

  it("shortcuts are disabled without a connection", async () => {
    connectionState = "disconnected";
    withShortcuts([
      { label: "Yes", text: "yes" },
      { label: "OK", text: "ok" },
    ]);
    const user = userEvent.setup();
    renderComposer();

    expect(shortcut(0)).toBeDisabled();
    expect(shortcut(1)).toBeDisabled();
    await user.click(shortcut(0));
    fireEvent.click(shortcut(1));
    expect(send).not.toHaveBeenCalled();
    expect(onSubmitted).not.toHaveBeenCalled();

    // The socket coming back is what enables them again.
    connectionState = "connected";
    for (const cb of [...(listeners.get(SESSION) ?? [])]) cb("connected");
    await waitFor(() => expect(shortcut(0)).toBeEnabled());
  });

  it("an empty list renders no shortcut chips", () => {
    withShortcuts([]);
    renderComposer();

    expect(screen.queryByTestId(`answer-pane-shortcut-0-${SESSION}`)).not.toBeInTheDocument();
    const row = screen.getByRole("button", { name: "/ skills" }).parentElement as HTMLElement;
    expect(Array.from(row.children).map((chip) => chip.textContent?.trim())).toEqual(["/ skills"]);
  });

  it("shortcut chips are touch-sized on a phone", () => {
    withShortcuts([{ label: "A label twenty-four long", text: "yes" }]);
    renderComposer();
    expect(shortcut(0)).toHaveClass("answer-pane-shortcut-chip");

    // At least 32px tall under the touch viewport's media query.
    const touch = declarationsOf(touchBlocks(), ".answer-pane-shortcut-chip");
    expect(parseFloat(touch["min-height"] ?? "0")).toBeGreaterThanOrEqual(32);

    // A long label is cut with an ellipsis rather than widening the row.
    const label = declarationsOf(css, ".answer-pane-shortcut-label");
    expect(label["text-overflow"]).toBe("ellipsis");
    expect(label["overflow"]).toBe("hidden");
    expect(label["white-space"]).toBe("nowrap");
    expect(declarationsOf(css, ".answer-pane-shortcut-chip")["max-width"]).toBeTruthy();
  });
});
