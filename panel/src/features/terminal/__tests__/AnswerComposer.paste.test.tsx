/**
 * Pasting a screenshot into the composer.
 *
 * The composer is rendered on its own here, unlike `AnswerComposer.test.tsx`
 * which goes through `AnswerPane`. That file's criteria were about the field's
 * PLACE — Escape stopped by the pane's root, the switch in the meta row, the
 * grip as the pane's bottom edge — and a field rendered alone would have been
 * pinning a component no user meets. None of that applies to a paste: the
 * clipboard reaches the textarea and nothing above it participates. What IS
 * mounted alongside is `ToastHost`, because "the failure is surfaced" is a
 * claim about the panel's real notification surface rather than about a spy.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ToastHost from "../../../components/ToastHost";
import { dismissToast } from "../../../lib/toast";
import { AnswerComposer } from "../AnswerComposer";

/** What the server answers with — the same shape `uploadPastedImage` reads. */
const SAVED = "/tmp/pavilio-pastes/paste-1.png";

const send = vi.fn();
const fetchFn = vi.fn();

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** jsdom has no `matchMedia`, and the grip's hook asks it for the viewport. */
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

function renderComposer() {
  return render(
    <>
      <AnswerComposer sessionId="cell-a" send={send} />
      <ToastHost />
    </>,
  );
}

const field = (): HTMLTextAreaElement =>
  screen.getByTestId("answer-pane-composer-cell-a") as HTMLTextAreaElement;

/** The attachment chips standing beside the field, in order. */
const chips = (): HTMLElement[] => screen.queryAllByTestId(/^answer-pane-attachment-cell-a-/);

/**
 * A clipboard carrying one image, shaped the way `clipboardData` is read —
 * an `items` list whose entries answer `kind`, `type` and `getAsFile()`.
 */
function imageClipboard(file: File) {
  return {
    items: [{ kind: "file", type: file.type, getAsFile: () => file }],
    getData: () => "",
  };
}

const shot = (): File => new File(["x"], "shot.png", { type: "image/png" });

/**
 * Types `look at please` and puts the caret back between `at ` and `please`.
 *
 * The caret is the point of the exercise: index 8 is neither end of the field,
 * so a handler that appends the path — or prepends it — writes a different
 * string than a handler that inserts it where the user was.
 */
async function typeAroundACaret(user: ReturnType<typeof userEvent.setup>) {
  await user.click(field());
  await user.keyboard("look at please");
  field().setSelectionRange(8, 8);
}

beforeEach(() => {
  send.mockClear();
  fetchFn.mockReset();
  dismissToast();
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  vi.stubGlobal("fetch", fetchFn);
  installMatchMedia();
});

describe("AnswerComposer paste", () => {
  it("uploads a pasted image and inserts the saved path at the caret", async () => {
    fetchFn.mockResolvedValue({ ok: true, json: async () => ({ path: SAVED }) });
    const user = userEvent.setup();
    renderComposer();
    await typeAroundACaret(user);

    fireEvent.paste(field(), { clipboardData: imageClipboard(shot()) });

    // Where the caret was, not at the end — and with the trailing space the
    // terminal's own paste handler appends, so the next word the user types
    // is not run into the filename.
    await waitFor(() => expect(field().value).toBe(`look at ${SAVED} please`));

    // The same request the terminal's handler makes, down to the session id:
    // the server chowns the saved file to the OS user behind that session.
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("/api/terminal/paste-image");
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect(form.get("sessionId")).toBe("cell-a");
    expect(form.get("image")).toBeInstanceOf(File);

    // A paste is not a send: nothing reaches the PTY until Enter.
    expect(send).not.toHaveBeenCalled();
  });

  it("leaves a pasted text clipboard alone", async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(field());
    await user.paste("just words");

    // The textarea's own insertion did this — the handler never called
    // `preventDefault` — and no upload was attempted for a clipboard with no
    // image in it.
    expect(field().value).toBe("just words");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("reports a failed upload and changes nothing", async () => {
    fetchFn.mockResolvedValue({ ok: false });
    const user = userEvent.setup();
    renderComposer();
    await typeAroundACaret(user);

    fireEvent.paste(field(), { clipboardData: imageClipboard(shot()) });

    // The panel's own toast, not a console line: a paste that silently did
    // nothing is indistinguishable from a paste that was ignored.
    const toast = await screen.findByTestId("toast");
    expect(toast).toHaveTextContent(/pasted image/i);

    // And the field is exactly as the user left it.
    expect(field().value).toBe("look at please");
    expect(send).not.toHaveBeenCalled();
  });

  it("splices into the text typed while the upload was in flight", async () => {
    // The round trip, held open: the paste handler is inside its `then` for as
    // long as this promise is unresolved, which is the window the user types in.
    let answer!: (response: { ok: boolean; json: () => Promise<unknown> }) => void;
    fetchFn.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const user = userEvent.setup();
    renderComposer();
    await typeAroundACaret(user);

    fireEvent.paste(field(), { clipboardData: imageClipboard(shot()) });

    // Still in flight, and the user has not stopped writing the sentence the
    // screenshot belongs to.
    expect(field().value).toBe("look at please");
    field().setSelectionRange("look at please".length, "look at please".length);
    await user.keyboard(" now");
    expect(field().value).toBe("look at please now");

    answer({ ok: true, json: async () => ({ path: SAVED }) });

    // BOTH halves survive: the path lands at the caret the paste was made at,
    // and the four characters typed after it are still there. The splice reads
    // the field as it is when the upload answers — a handler that closed over
    // the text as it was at paste time would write `look at <path> please` and
    // silently swallow " now".
    await waitFor(() => expect(field().value).toBe(`look at ${SAVED} please now`));
  });

  it("keeps the pasted path when the composer is unmounted and built again", async () => {
    fetchFn.mockResolvedValue({ ok: true, json: async () => ({ path: SAVED }) });
    const user = userEvent.setup();
    const view = renderComposer();
    await typeAroundACaret(user);

    fireEvent.paste(field(), { clipboardData: imageClipboard(shot()) });
    await waitFor(() => expect(field().value).toBe(`look at ${SAVED} please`));

    // The pane is destroyed on Escape and rebuilt on reopen, and the rebuilt
    // field is seeded from the draft store rather than from whatever the last
    // mount held. Every assertion above this one passes just as well against a
    // paste that only ever reached `useState` — and that paste loses the path
    // the moment the user closes the pane without typing another character,
    // which is exactly what "the field still holds that text" forbids.
    view.unmount();
    renderComposer();

    expect(field().value).toBe(`look at ${SAVED} please`);
  });

  /**
   * The attachment chip.
   *
   * design.md draws the chip INSIDE the field, with the path still underneath
   * it as editable text. A `<textarea>` holds text, not elements, so that
   * drawing cannot be built as drawn — and the shipped behaviour it would have
   * to replace is one Greg tested by hand and asked to keep: the raw path is
   * spliced at the caret and stays editable mid-path, so a screenshot saved
   * somewhere else can be pointed at by typing over it.
   *
   * So the chip is honest about being outside the field: it names the file and
   * is DERIVED from the path, which is why it follows the text rather than
   * being a second record of it. Edit the path away and the chip goes with it —
   * there is no longer an attachment of that name in the reply.
   */
  it("names the pasted file in a chip beside the still-editable path", async () => {
    fetchFn.mockResolvedValue({ ok: true, json: async () => ({ path: SAVED }) });
    const user = userEvent.setup();
    renderComposer();
    await typeAroundACaret(user);

    fireEvent.paste(field(), { clipboardData: imageClipboard(shot()) });
    await waitFor(() => expect(field().value).toBe(`look at ${SAVED} please`));

    // The basename, not the path: the chip is the glance, the field is the
    // record.
    expect(chips()).toHaveLength(1);
    expect(chips()[0]).toHaveTextContent("paste-1.png");
    expect(chips()[0]).not.toHaveTextContent("/tmp/pavilio-pastes");

    // The path is still the field's text, and still what reaches the PTY.
    await user.click(field());
    await user.keyboard("{Enter}");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(`look at ${SAVED} please\r`);
  });

  it("drops the chip when the path it names is edited away", async () => {
    fetchFn.mockResolvedValue({ ok: true, json: async () => ({ path: SAVED }) });
    const user = userEvent.setup();
    renderComposer();
    await typeAroundACaret(user);

    fireEvent.paste(field(), { clipboardData: imageClipboard(shot()) });
    await waitFor(() => expect(field().value).toBe(`look at ${SAVED} please`));
    expect(chips()).toHaveLength(1);

    // The same edit `sends the edited path rather than the inserted one`
    // makes. The chip is derived, so it cannot outlive what it was derived
    // from — a chip still claiming `paste-1.png` over a reply pointing at
    // `crop.png` would be the panel telling the user something untrue.
    field().setSelectionRange(8, 8 + SAVED.length);
    await user.keyboard("/srv/shots/crop.png");

    expect(chips()).toHaveLength(0);
  });

  it("sends the edited path rather than the inserted one", async () => {
    fetchFn.mockResolvedValue({ ok: true, json: async () => ({ path: SAVED }) });
    const user = userEvent.setup();
    renderComposer();
    await typeAroundACaret(user);

    fireEvent.paste(field(), { clipboardData: imageClipboard(shot()) });
    await waitFor(() => expect(field().value).toBe(`look at ${SAVED} please`));

    // Select the path that was just inserted and type over it: what the field
    // holds at Enter is the contract, not what the upload put there.
    field().setSelectionRange(8, 8 + SAVED.length);
    await user.keyboard("/srv/shots/crop.png");
    await user.keyboard("{Enter}");

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("look at /srv/shots/crop.png please\r");
  });
});
