/**
 * The command picker at the composer: a `/` at the start of an empty draft
 * opens a filtering list of the workspace's skills, and while it is open it
 * takes Escape and Enter ahead of the composer.
 *
 * Asserted through `AnswerPane`, like `AnswerComposer.test.tsx`, because two of
 * the criteria are about keys the PANE owns — Escape closes the pane from its
 * root, Enter sends from the field — and the picker's whole job is to take
 * them first and give them back. A harness that rendered the picker alone
 * could not see either handover.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MOBILE_QUERY } from "../../../lib/breakpoints";
import type { GridSpeech, SpeechUnit } from "../../speech/types";
import { emptyUtteranceQueue } from "../../speech/utteranceQueue";
import { AnswerPane } from "../AnswerPane";
import { __resetAnswerWaitingForTests } from "../answerWaiting";
import type { SkillEntry } from "../commandSource";
import { __resetPtySubmitForTests } from "../ptySubmit";
import { refreshSessions } from "../sessionStore";
import type { SessionMeta } from "../useTerminalSessions";

vi.mock("../../speech/synth", () => ({
  isSpeechSynthesized: () => false,
  speechCacheState: () => "cold",
  subscribeSpeechCache: () => () => {},
}));

vi.mock("../../markdown/MermaidDiagram", () => ({
  default: ({ chart }: { chart: string }) => <div data-testid="mermaid">{chart}</div>,
}));

const NO_UNITS: readonly SpeechUnit[] = Object.freeze([]);
const NO_DURATIONS: ReadonlyMap<number, number> = new Map<number, number>();
const NOTHING_HEARD: ReadonlySet<string> = new Set<string>();

function makeSpeech(): GridSpeech {
  return {
    stateFor: () => "ready",
    queueFor: () => emptyUtteranceQueue,
    heardFor: () => NOTHING_HEARD,
    unitsFor: () => NO_UNITS,
    subscribeProgress: () => () => {},
    progressFor: () => null,
    unitDurationsFor: () => NO_DURATIONS,
    armedSessionId: null,
    onSpeak: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onStop: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onNewestAnswer: vi.fn(),
    onArm: vi.fn(),
    onJumpToUnit: vi.fn(),
    onSeekWithinUnit: vi.fn(),
  } satisfies GridSpeech;
}

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function installMatchMedia(mobile: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: mobile && query === MOBILE_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

/** Served out of order on purpose: the picker must show them alphabetically. */
const SKILLS: SkillEntry[] = [
  {
    name: "pavilio-grill",
    description: "Stress-test an idea",
    path: "skills/pavilio-grill/SKILL.md",
  },
  {
    name: "pavilio-question",
    description: "Answer questions from notes",
    path: "skills/pavilio-question/SKILL.md",
  },
  {
    name: "pavilio-execute-plan",
    description: "Run a plan",
    path: "skills/pavilio-execute-plan/SKILL.md",
  },
];

function session(id: string): SessionMeta {
  return {
    id,
    name: id,
    project: "alpha",
    cwd: "/srv/git/alpha",
    pid: 4242,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/** `resume` is in its description only — the name says nothing about it. */
const SESSION_START: SkillEntry = {
  name: "pavilio-session-start",
  description: "Start or resume a project session",
  path: "skills/pavilio-session-start/SKILL.md",
};

/** What `/api/skills` answers with; null holds the answer back (still loading). */
let served: SkillEntry[] | null = SKILLS;

/** One fetch for both endpoints this tree reaches: the session list and the skills. */
function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const isSkills = String(url).includes("/api/skills");
      if (isSkills && served === null) return new Promise<Response>(() => {});
      const body = isSkills ? served : [session("cell-a")];
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(body),
      }) as unknown as Promise<Response>;
    }),
  );
}

const send = vi.fn((_data: string) => true);
const onClose = vi.fn();

function renderPane() {
  return render(
    <MemoryRouter>
      <AnswerPane sessionId="cell-a" speech={makeSpeech()} onClose={onClose} send={send} />
    </MemoryRouter>,
  );
}

const field = (): HTMLTextAreaElement =>
  screen.getByTestId("answer-pane-composer-cell-a") as HTMLTextAreaElement;

const picker = (): HTMLElement | null => screen.queryByRole("listbox");

/** The options once the list has arrived. */
async function options(): Promise<HTMLElement[]> {
  return waitFor(() => {
    const found = screen.getAllByRole("option");
    expect(found.length).toBeGreaterThan(0);
    return found;
  });
}

const expectSubmitted = async (body: string): Promise<void> => {
  await waitFor(() => expect(send.mock.calls).toEqual([[body], ["\r"]]));
};

beforeEach(async () => {
  served = SKILLS;
  send.mockClear();
  onClose.mockClear();
  __resetAnswerWaitingForTests();
  __resetPtySubmitForTests();
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  installMatchMedia(false);
  stubFetch();
  await refreshSessions();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CommandPicker", () => {
  it("opens on a slash at the start of the draft", async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    await user.keyboard("/");

    expect(picker()).toBeInTheDocument();
    // Alphabetical, whatever order the server listed them in.
    const names = (await options()).map((o) => o.getAttribute("data-name"));
    expect(names).toEqual(["pavilio-execute-plan", "pavilio-grill", "pavilio-question"]);
    // The field points at the list and at the highlighted entry.
    expect(field()).toHaveAttribute("aria-controls", picker()!.id);
    expect(field()).toHaveAttribute("aria-activedescendant", (await options())[0].id);
  });

  it("filters on what is typed after the slash", async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    await user.keyboard("/notes");

    // Matched on the description: the name says nothing about notes.
    const names = (await options()).map((o) => o.getAttribute("data-name"));
    expect(names).toEqual(["pavilio-question"]);
  });

  it("does not open on a slash inside the text", async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    await user.keyboard("see src/");

    expect(field().value).toBe("see src/");
    expect(picker()).not.toBeInTheDocument();
  });

  it("Escape closes the picker and leaves the pane open", async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    await user.keyboard("/");
    await options();
    await user.keyboard("{Escape}");

    expect(picker()).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    // The slash the user may have meant to send survives.
    expect(field().value).toBe("/");
  });

  it("Escape closes the pane once the picker is closed", async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    await user.keyboard("/");
    await options();
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Enter picks while open and does not send", async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    await user.keyboard("/");
    await options();
    // Arrow keys move the highlight; Down once is the second entry.
    await user.keyboard("{ArrowDown}{Enter}");

    expect(field().value).toBe("/pavilio-grill");
    expect(picker()).not.toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("Enter sends once the picker is closed", async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    await user.keyboard("/");
    await options();
    await user.keyboard("{Escape}{Enter}");

    await expectSubmitted("/");
  });

  it("Enter sends after a pick, once an argument follows", async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    await user.keyboard("/question");
    await options();
    await user.keyboard("{Enter}");
    expect(field().value).toBe("/pavilio-question");

    // A space ends the token: the trimmed query would still match, so the
    // picker must close on its own or this Enter would pick again.
    await user.keyboard(" who is Ann{Enter}");
    // The field showed the short form; the PTY gets the portable instruction.
    await expectSubmitted(
      "Read and follow the instructions in skills/pavilio-question/SKILL.md exactly. ARGUMENTS: who is Ann",
    );
  });

  it("a space after the token closes the picker", async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    await user.keyboard("/pavilio-question");
    await options();
    await user.keyboard(" ");

    expect(picker()).not.toBeInTheDocument();
    await user.keyboard("{Enter}");
    await expectSubmitted(
      "Read and follow the instructions in skills/pavilio-question/SKILL.md exactly. ARGUMENTS:",
    );
  });

  it("the short form lands at the caret with the caret after it", async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    await user.keyboard("/gri");
    const [only] = await options();
    await user.click(only);

    expect(field().value).toBe("/pavilio-grill");
    expect(field().selectionStart).toBe("/pavilio-grill".length);
    expect(field().selectionEnd).toBe("/pavilio-grill".length);
    // Picking by pointer leaves the caret in the field, ready for the argument.
    expect(document.activeElement).toBe(field());
  });

  it("picking the command already typed keeps the caret with the text", async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    // Typed in full, so the pick leaves the text exactly as it was.
    await user.keyboard("/pavilio-grill");
    await options();
    await user.keyboard("{Enter}");
    expect(field().value).toBe("/pavilio-grill");

    await user.keyboard(" my idea");
    expect(field().value).toBe("/pavilio-grill my idea");
    expect(field().selectionStart).toBe("/pavilio-grill my idea".length);
  });

  it("a pick in front of other text leaves the caret right after the name", async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    await user.keyboard("see this");
    field().setSelectionRange(0, 0);
    // The chip opens the picker at the caret, ahead of the existing text.
    await user.click(screen.getByTestId("answer-pane-skills-chip-cell-a"));
    expect(field().value).toBe("/ see this");
    await user.keyboard("gri");
    await options();
    await user.keyboard("{Enter}");

    expect(field().value).toBe("/pavilio-grill see this");
    // Not the end of the field, where a plain value write would leave it.
    expect(field().selectionStart).toBe("/pavilio-grill".length);
    expect(field().selectionEnd).toBe("/pavilio-grill".length);
  });

  it("a CLI built-in with no name match is sent on Enter", async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    await user.keyboard("/clear");
    await screen.findByText("No skill matches.");
    await user.keyboard("{Enter}");

    await expectSubmitted("/clear");
    expect(picker()).not.toBeInTheDocument();
  });

  it("a description-only match is listed but Enter sends", async () => {
    served = [...SKILLS, SESSION_START];
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    await user.keyboard("/resume");
    const listed = await options();
    expect(listed.map((o) => o.getAttribute("data-name"))).toEqual(["pavilio-session-start"]);
    // Listed, not highlighted: Enter has nothing to pick, and says so.
    expect(listed[0]).toHaveAttribute("aria-selected", "false");
    expect(field()).not.toHaveAttribute("aria-activedescendant");
    expect(screen.getByText(/Enter send/)).toBeInTheDocument();
    await user.keyboard("{Enter}");

    await expectSubmitted("/resume");
  });

  it("a name fragment is highlighted and Enter picks", async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    await user.keyboard("/pav");
    const [first] = await options();
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/Enter insert/)).toBeInTheDocument();
    await user.keyboard("{Enter}");

    expect(field().value).toBe("/pavilio-execute-plan");
    expect(send).not.toHaveBeenCalled();
  });

  it("arrowing onto a description match lets Enter pick it", async () => {
    served = [...SKILLS, SESSION_START];
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    await user.keyboard("/resume");
    await options();
    await user.keyboard("{ArrowDown}{Enter}");

    expect(field().value).toBe("/pavilio-session-start");
    expect(send).not.toHaveBeenCalled();
  });

  it("Enter does nothing while the list is still loading", async () => {
    served = null;
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    await user.keyboard("/pav");
    await screen.findByText("Loading skills…");
    await user.keyboard("{Enter}");

    expect(field().value).toBe("/pav");
    expect(picker()).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("moving the caret out of the token closes the picker", async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    await user.keyboard("/gri");
    await options();
    // No edit, only a caret move: `onChange` never fires for it.
    await user.keyboard("{Home}");

    expect(field().selectionStart).toBe(0);
    expect(picker()).not.toBeInTheDocument();
    expect(field().value).toBe("/gri");
  });

  it("Up from the first entry wraps to the last", async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    await user.keyboard("/");
    await options();
    await user.keyboard("{ArrowUp}{Enter}");

    expect(field().value).toBe("/pavilio-question");
  });

  it("Down from the last entry wraps to the first", async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    await user.keyboard("/");
    await options();
    // Three entries: two steps reach the last, the third wraps.
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");

    expect(field().value).toBe("/pavilio-execute-plan");
  });

  it("a press outside the composer closes the picker", async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    await user.keyboard("/gri");
    await options();
    await user.click(document.body);

    expect(picker()).not.toBeInTheDocument();
    expect(field().value).toBe("/gri");
    expect(send).not.toHaveBeenCalled();
  });

  it("the picker opens on a touch viewport", async () => {
    installMatchMedia(true);
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    await user.keyboard("/");

    expect(picker()).toBeInTheDocument();
    expect((await options()).length).toBe(3);
  });
});
