import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewComment } from "../../../../../server/lib/prs/provider";
import type { ReviewThread } from "../../reviewThreads";

const speech = vi.hoisted(() => ({ speakDocument: vi.fn() }));

vi.mock("../../../speech/SpeechHostProvider", () => ({ usePageSpeech: () => speech }));
vi.mock("../../../markdown/MarkdownRenderer", () => ({
  default: ({ content, untrusted }: { content: string; untrusted?: { linkBase: string } }) => (
    <div data-testid="md" data-link-base={untrusted?.linkBase}>
      {content}
    </div>
  ),
}));

import CommentMarker from "../CommentMarker";

const NOW = new Date("2026-11-23T12:00:00Z").getTime();
const KEY = "pavilio//pr/gmotyl/pavilio/7";

const comment = (over: Partial<ReviewComment>): ReviewComment => ({
  id: 990,
  replyTo: null,
  path: "docs/README.md",
  line: 14,
  side: "new",
  author: "kwojcik",
  body: "Should `prod` link to the prod tfvars?",
  createdAt: "2026-11-23T10:00:00Z",
  url: "https://github.com/gmotyl/pavilio/pull/7#discussion_r990",
  ...over,
});

const ROOT = comment({});
const REPLY = comment({
  id: 991,
  replyTo: 990,
  author: "gmotyl",
  body: "It does.<!-- hidden prompt -->",
  createdAt: "2026-11-23T11:00:00Z",
  url: "https://github.com/gmotyl/pavilio/pull/7#discussion_r991",
});
const thread = (comments: ReviewComment[]): ReviewThread => ({ anchor: { side: "new", line: 14 }, comments });
const TWO = thread([ROOT, REPLY]);

const marker = () => screen.getByRole("button", { name: /comments? on line 14/ });
const dialog = () => screen.getByRole("dialog", { name: /on line 14/ });

/** The marker inline between two page controls, as in the viewer's table. */
const Inline = () => (
  <div>
    <button type="button" data-testid="before">
      before
    </button>
    <CommentMarker thread={TWO} speechKey={KEY} />
    <button type="button" data-testid="after">
      after
    </button>
  </div>
);
const TABBABLE = "button:not([disabled]), a[href]";
/** jsdom has no native Tab: dispatch keydown and, unless a handler took it, step through document order. */
const tab = (shift = false) => {
  const from = document.activeElement as HTMLElement;
  if (!fireEvent.keyDown(from, { key: "Tab", shiftKey: shift })) return;
  const all = Array.from(document.querySelectorAll<HTMLElement>(TABBABLE));
  const next = all[all.indexOf(from) + (shift ? -1 : 1)];
  act(() => (next ? next.focus() : from.blur()));
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(NOW);
  speech.speakDocument.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("CommentMarker", () => {
  it("CommentMarker shows a count badge only for 2+ comments", () => {
    const { unmount } = render(<CommentMarker thread={TWO} speechKey={KEY} me="gmotyl" />);
    expect(marker()).toHaveAccessibleName("2 comments on line 14");
    expect(marker().querySelector("svg")).not.toBeNull();
    expect(marker().querySelector(".fv-cmk")).toHaveTextContent("2");
    unmount();

    render(<CommentMarker thread={thread([ROOT])} speechKey={KEY} />);
    expect(marker()).toHaveAccessibleName("1 comment on line 14");
    expect(marker().querySelector(".fv-cmk")).toBeNull();
  });

  it("CommentMarker opens the thread on hover and on focus", () => {
    const { unmount } = render(<CommentMarker thread={TWO} speechKey={KEY} me="gmotyl" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(marker()).toHaveAttribute("aria-haspopup", "dialog");
    expect(marker()).toHaveAttribute("aria-expanded", "false");
    fireEvent.pointerEnter(marker(), { pointerType: "mouse" });
    const pop = dialog();
    expect(marker()).toHaveAttribute("aria-expanded", "true");
    // Portal: outside the marker's own subtree, so the table's overflow can't clip it.
    expect(marker().parentElement?.contains(pop)).toBe(false);
    expect(pop.parentElement).toBe(document.body);
    expect(pop.querySelector("header")).toHaveTextContent("Line 14 · 2 comments");
    expect(within(pop).getByRole("button", { name: "Play thread" })).toHaveTextContent("▷ Play all");
    const msgs = pop.querySelectorAll(".fv-cmmsg");
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toHaveTextContent("KW");
    expect(msgs[0]).toHaveTextContent("kwojcik · 2 h ago");
    expect(within(msgs[0] as HTMLElement).getByRole("button", { name: "Play comment" })).toHaveTextContent("▷");
    // `me` reads as "you".
    expect(msgs[1]).toHaveTextContent("you · 1 h ago");
    expect(msgs[1]).not.toHaveTextContent("gmotyl");
    unmount();

    render(<CommentMarker thread={TWO} speechKey={KEY} me="gmotyl" />);
    act(() => marker().focus());
    expect(dialog()).toBeInTheDocument();
  });

  it("CommentMarker closes on pointer leave and Escape", () => {
    render(<CommentMarker thread={TWO} speechKey={KEY} />);
    fireEvent.pointerEnter(marker(), { pointerType: "mouse" });
    fireEvent.pointerLeave(marker(), { pointerType: "mouse" });
    // Moving onto the popover within the grace period keeps it open.
    act(() => vi.advanceTimersByTime(100));
    fireEvent.pointerEnter(dialog(), { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(500));
    expect(dialog()).toBeInTheDocument();
    fireEvent.pointerLeave(dialog(), { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(149));
    expect(dialog()).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(marker()).toHaveAttribute("aria-expanded", "false");

    fireEvent.pointerEnter(marker(), { pointerType: "mouse" });
    expect(dialog()).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("CommentMarker renders comment bodies untrusted", () => {
    render(<CommentMarker thread={TWO} speechKey={KEY} />);
    fireEvent.focus(marker());
    const bodies = within(dialog()).getAllByTestId("md");
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toHaveAttribute("data-link-base", ROOT.url);
    expect(bodies[0]).toHaveTextContent(ROOT.body);
    expect(bodies[1]).toHaveAttribute("data-link-base", REPLY.url);
    // prDescriptionSource drops the HTML comment.
    expect(bodies[1].textContent).toBe("It does.");
  });

  it("CommentMarker shows the read-only footer linking to GitHub", () => {
    render(<CommentMarker thread={TWO} speechKey={KEY} />);
    fireEvent.focus(marker());
    const footer = dialog().querySelector("footer")!;
    expect(footer).toHaveTextContent("Read-only · Reply on GitHub ↗");
    const link = within(footer).getByRole("link", { name: "Reply on GitHub ↗" });
    expect(link).toHaveAttribute("href", ROOT.url);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("CommentMarker Play speaks one comment under its key", () => {
    render(<CommentMarker thread={TWO} speechKey={KEY} me="gmotyl" />);
    fireEvent.focus(marker());
    const [first, second] = within(dialog()).getAllByRole("button", { name: "Play comment" });
    fireEvent.click(first);
    expect(speech.speakDocument).toHaveBeenCalledWith({ key: `${KEY}/c/990`, text: `kwojcik: ${ROOT.body}` });
    fireEvent.click(second);
    expect(speech.speakDocument).toHaveBeenLastCalledWith({ key: `${KEY}/c/991`, text: "gmotyl: It does." });
  });

  it("CommentMarker Play all speaks the thread in order", () => {
    render(<CommentMarker thread={TWO} speechKey={KEY} me="gmotyl" />);
    fireEvent.focus(marker());
    fireEvent.click(within(dialog()).getByRole("button", { name: "Play thread" }));
    expect(speech.speakDocument).toHaveBeenCalledTimes(1);
    expect(speech.speakDocument).toHaveBeenCalledWith({
      key: `${KEY}/t/990`,
      text: `kwojcik: ${ROOT.body}\n\ngmotyl: It does.`,
    });
  });
  it("CommentMarker one-comment thread has a single Play, speaking the thread", () => {
    render(<CommentMarker thread={thread([ROOT])} speechKey={KEY} />);
    fireEvent.focus(marker());
    const pop = dialog();
    const play = within(pop).getByRole("button", { name: "Play thread" });
    expect(play).toHaveTextContent("▷ Play");
    expect(play).not.toHaveTextContent("Play all");
    expect(within(pop).queryByRole("button", { name: "Play comment" })).toBeNull();
    fireEvent.click(play);
    expect(speech.speakDocument).toHaveBeenCalledWith({ key: `${KEY}/t/990`, text: `kwojcik: ${ROOT.body}` });
  });

  it("CommentMarker without a speech key renders no Play buttons", () => {
    render(<CommentMarker thread={TWO} />);
    fireEvent.focus(marker());
    expect(within(dialog()).queryByRole("button", { name: /Play/ })).toBeNull();
  });

  it("CommentMarker keeps a keyboard-opened popover open when the pointer leaves", () => {
    render(<CommentMarker thread={TWO} speechKey={KEY} />);
    act(() => marker().focus());
    fireEvent.pointerEnter(marker(), { pointerType: "mouse" });
    fireEvent.pointerLeave(marker(), { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(500));
    expect(dialog()).toBeInTheDocument();
    // Focus inside the popover holds it open too.
    act(() => within(dialog()).getByRole("button", { name: "Play thread" }).focus());
    fireEvent.pointerEnter(dialog(), { pointerType: "mouse" });
    fireEvent.pointerLeave(dialog(), { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(500));
    expect(dialog()).toBeInTheDocument();
  });

  it("CommentMarker Tab from the popover's last control closes it and moves past the marker", () => {
    render(<Inline />);
    act(() => marker().focus());
    const link = within(dialog()).getByRole("link", { name: "Reply on GitHub ↗" });
    act(() => link.focus());
    tab();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("after"));
    expect(marker()).toHaveAttribute("aria-expanded", "false");
    // Tab alone from here never re-opens it.
    tab();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("CommentMarker Tab never cycles back into the popover", () => {
    render(<Inline />);
    act(() => screen.getByTestId("before").focus());
    const seen: (Element | null)[] = [];
    for (let i = 0; i < 8; i++) {
      tab();
      seen.push(document.activeElement);
    }
    const inPop = (el: Element | null) => !!el?.closest('[role="dialog"]');
    const firstOut = seen.findIndex((el, i) => i > 0 && inPop(seen[i - 1]) && !inPop(el));
    // Into the popover once, out to the element after the marker, and never back in.
    expect(seen[0]).toBe(marker());
    expect(inPop(seen[1])).toBe(true);
    expect(seen[firstOut]).toBe(screen.getByTestId("after"));
    expect(seen.slice(firstOut).some(inPop)).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("CommentMarker Tab off the last control with nothing after leaves focus on the closed marker", () => {
    render(<CommentMarker thread={TWO} speechKey={KEY} />);
    act(() => marker().focus());
    const link = within(dialog()).getByRole("link", { name: "Reply on GitHub ↗" });
    act(() => link.focus());
    tab();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(marker());
  });

  it("CommentMarker Shift+Tab from the first control returns to the marker", () => {
    render(<Inline />);
    act(() => marker().focus());
    const play = within(dialog()).getByRole("button", { name: "Play thread" });
    act(() => play.focus());
    tab(true);
    expect(document.activeElement).toBe(marker());
  });

  it("CommentMarker footer links only to http(s) urls", () => {
    render(<CommentMarker thread={thread([comment({ url: "javascript:alert(1)" })])} speechKey={KEY} />);
    fireEvent.focus(marker());
    const footer = dialog().querySelector("footer")!;
    expect(footer).toHaveTextContent("Read-only · Reply on GitHub");
    expect(footer).not.toHaveTextContent("↗");
    expect(within(footer).queryByRole("link")).toBeNull();
    expect(footer.querySelector("a")).toBeNull();
  });
});
