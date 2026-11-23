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
});
