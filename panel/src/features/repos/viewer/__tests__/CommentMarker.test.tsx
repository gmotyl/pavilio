import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewComment } from "../../../../../server/lib/prs/provider";
import type { ReviewThread } from "../../reviewThreads";

const speech = vi.hoisted(() => ({ speakDocument: vi.fn(), stopDocument: vi.fn() }));
/** The host's read side and transport, as the speech row reads them: a state per key. */
const host = vi.hoisted(() => ({
  states: new Map<string, string>(),
  stateFor(key: string) {
    return this.states.get(key) ?? "empty";
  },
  onPause: vi.fn(),
  onResume: vi.fn(),
}));

vi.mock("../../../speech/SpeechHostProvider", () => ({ usePageSpeech: () => speech, usePanelSpeech: () => host }));
vi.mock("../../../markdown/MarkdownRenderer", () => ({
  default: ({ content, untrusted }: { content: string; untrusted?: { linkBase: string } }) => (
    <div data-testid="md" data-link-base={untrusted?.linkBase}>
      {content}
    </div>
  ),
}));

import { preparePage } from "../../../speech/pageText";
import { stripToSpeakableText } from "../../../speech/strip";
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
  commitId: "head",
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

const marker = () => screen.getByRole("button", { name: /^\d+ comments? on line 14$/ });
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
  speech.stopDocument.mockReset();
  host.states.clear();
  host.onPause.mockReset();
  host.onResume.mockReset();
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
    expect(within(pop).getByRole("button", { name: "Play all comments on line 14" })).toHaveTextContent("Play all");
    const msgs = pop.querySelectorAll(".fv-cmmsg");
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toHaveTextContent("KW");
    expect(msgs[0]).toHaveTextContent("kwojcik · 2 h ago");
    expect(within(msgs[0] as HTMLElement).getByRole("button", { name: "Play comment by kwojcik" })).toHaveAttribute("data-icon", "play");
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

  it("CommentMarker shows the read-only note once and a reply link to GitHub", () => {
    render(<CommentMarker thread={TWO} speechKey={KEY} />);
    fireEvent.focus(marker());
    const footer = dialog().querySelector("footer")!;
    expect(footer).toHaveTextContent(/^Read-only$/);
    const links = within(dialog()).getAllByRole("link", { name: "Reply on GitHub ↗" });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", ROOT.url);
    expect(links[0]).toHaveAttribute("target", "_blank");
  });

  it("CommentMarker gives each root conversation on the line its own reply link", () => {
    const OTHER = comment({
      id: 995,
      author: "ajanik",
      body: "Unrelated nit.",
      createdAt: "2026-11-23T10:30:00Z",
      url: "https://github.com/gmotyl/pavilio/pull/7#discussion_r995",
    });
    // groupThreads sorts by time: the roots' comments interleave.
    render(<CommentMarker thread={thread([ROOT, OTHER, REPLY])} speechKey={KEY} />);
    fireEvent.focus(marker());
    const pop = dialog();
    const links = within(pop).getAllByRole("link", { name: "Reply on GitHub ↗" });
    expect(links.map((a) => a.getAttribute("href"))).toEqual([ROOT.url, OTHER.url]);
    // Each conversation reads as one: the reply sits with its root, the link under its last comment.
    const order = [...pop.querySelectorAll(".fv-cmmsg, a")].map((el) =>
      el.tagName === "A" ? `link:${el.getAttribute("href")}` : el.querySelector("b")!.textContent,
    );
    expect(order).toEqual(["kwojcik", "gmotyl", `link:${ROOT.url}`, "ajanik", `link:${OTHER.url}`]);
    expect(within(pop).getAllByText("Read-only")).toHaveLength(1);
  });

  it("GitLab thread popover links Reply on GitLab with unchanged layout", () => {
    const MR = "https://gitlab.example.com/grp/pavilio/-/merge_requests/7";
    const OTHER = comment({ id: 995, author: "ajanik", body: "Unrelated nit.", createdAt: "2026-11-23T10:30:00Z" });
    const comments = [ROOT, OTHER, REPLY].map((c) => ({ ...c, url: `${MR}#note_${c.id}` }));

    const { unmount } = render(<CommentMarker thread={thread(comments)} speechKey={KEY} me="gmotyl" />);
    fireEvent.focus(marker());
    const github = dialog().innerHTML;
    unmount();

    render(<CommentMarker thread={thread(comments)} speechKey={KEY} me="gmotyl" forge="gitlab" />);
    fireEvent.focus(marker());
    const pop = dialog();
    expect(pop.querySelector("header")).toHaveTextContent("Line 14 · 3 comments");
    // A Play (▷) per comment.
    const msgs = pop.querySelectorAll(".fv-cmmsg");
    expect(msgs).toHaveLength(3);
    for (const m of msgs) expect(within(m as HTMLElement).getByRole("button", { name: /^Play comment by / })).toBeInTheDocument();
    expect(pop.querySelector("footer")).toHaveTextContent(/^Read-only$/);
    expect(within(pop).getAllByText("Read-only")).toHaveLength(1);
    // One reply link per root, to its GitLab discussion.
    const links = within(pop).getAllByRole("link", { name: "Reply on GitLab ↗" });
    expect(links.map((a) => a.getAttribute("href"))).toEqual([`${MR}#note_990`, `${MR}#note_995`]);
    expect(within(pop).queryByRole("link", { name: "Reply on GitHub ↗" })).toBeNull();
    // Everything else is the GitHub popover's markup, word for word.
    expect(pop.innerHTML.replaceAll("Reply on GitLab", "Reply on GitHub")).toBe(github);
  });

  it("CommentMarker Play speaks the author on a line of its own, so a leading fence still strips", () => {
    const SUGGEST = comment({ body: "```suggestion\nconst prod = true;\n```\nPlease rename this flag." });
    render(<CommentMarker thread={thread([SUGGEST, REPLY])} speechKey={KEY} />);
    fireEvent.focus(marker());
    fireEvent.click(within(dialog()).getByRole("button", { name: "Play all comments on line 14" }));
    const spoken = stripToSpeakableText(speech.speakDocument.mock.calls[0][0].text);
    expect(spoken).toContain("kwojcik:");
    expect(spoken).not.toContain("const prod");
    expect(spoken).toContain("Please rename this flag.");
    expect(spoken).toContain("It does.");
    fireEvent.click(within(dialog()).getAllByRole("button", { name: /^Play comment by / })[0]);
    expect(stripToSpeakableText(speech.speakDocument.mock.calls[1][0].text)).toContain("Please rename this flag.");
  });

  it("CommentMarker Play all keeps the replies after a comment whose code fence never closes", () => {
    const OPEN = comment({ body: "```suggestion\nconst prod = true;" });
    render(<CommentMarker thread={thread([OPEN, REPLY])} speechKey={KEY} />);
    fireEvent.focus(marker());
    fireEvent.click(within(dialog()).getByRole("button", { name: "Play all comments on line 14" }));
    const spoken = stripToSpeakableText(speech.speakDocument.mock.calls[0][0].text);
    expect(spoken).toContain("kwojcik:");
    expect(spoken).not.toContain("const prod");
    expect(spoken).toContain("gmotyl:");
    expect(spoken).toContain("It does.");
  });

  it("CommentMarker Play all speaks every sentence of real review comments through the page pipeline", () => {
    // PR #238's own thread: a Kilo finding (TL;DR/WARNING labels, inline code,
    // a path) and the reply that quotes a ```suggestion fence inline.
    const KILO = comment({
      author: "kilo-code-bot[bot]",
      body:
        "**TL;DR:** If a note starts with a code sample, Play can read the code and skip the words that explain it.\n\n" +
        "**WARNING:** Prefixing the body with `author: ` on the same line (here and in Play All) hides a leading Markdown fence from `strip.ts`'s line-anchored matcher. " +
        "The closing fence is then treated as a new opening fence, so trailing prose and potentially later replies are swallowed.",
    });
    const FIXED = comment({
      id: 991,
      replyTo: 990,
      author: "gmotyl",
      createdAt: "2026-11-23T11:00:00Z",
      body:
        "Fixed in 78476b3. Speech text is now `author:` + blank line + body, in Play and Play all, so `strip.ts`'s line-anchored fence matcher sees a leading fence. " +
        "The test runs a comment that starts with a ```suggestion block through the real `stripToSpeakableText` and asserts the trailing prose and the reply survive.",
    });
    render(<CommentMarker thread={thread([KILO, FIXED])} speechKey={KEY} />);
    fireEvent.focus(marker());
    fireEvent.click(within(dialog()).getByRole("button", { name: "Play all comments on line 14" }));
    const units = preparePage(speech.speakDocument.mock.calls[0][0].text, "en").units.map((u) => u.text);
    const spoken = units.join(" ");
    expect(units[0]).toBe("kilo-code-bot[bot]:");
    expect(spoken).toContain("TL;DR: If a note starts with a code sample, Play can read the code and skip the words that explain it.");
    expect(spoken).toContain("so trailing prose and potentially later replies are swallowed.");
    expect(spoken).toContain("gmotyl:");
    expect(spoken).toContain(
      "The test runs a comment that starts with a suggestion block through the real stripToSpeakableText and asserts the trailing prose and the reply survive.",
    );
  });

  it("CommentMarker stops the speech it started when it unmounts", () => {
    const { unmount } = render(<CommentMarker thread={TWO} speechKey={KEY} />);
    fireEvent.focus(marker());
    fireEvent.click(within(dialog()).getByRole("button", { name: "Play all comments on line 14" }));
    fireEvent.click(within(dialog()).getAllByRole("button", { name: /^Play comment by / })[1]);
    expect(speech.stopDocument).not.toHaveBeenCalled();
    unmount();
    expect(speech.stopDocument).toHaveBeenCalledWith(`${KEY}/t/990`);
    expect(speech.stopDocument).toHaveBeenCalledWith(`${KEY}/c/991`);
    expect(speech.stopDocument).toHaveBeenCalledTimes(2);
  });

  it("CommentMarker unmounting without playing stops nothing", () => {
    const { unmount } = render(<CommentMarker thread={TWO} speechKey={KEY} />);
    unmount();
    expect(speech.stopDocument).not.toHaveBeenCalled();
  });

  it("CommentMarker Play speaks one comment under its key", () => {
    render(<CommentMarker thread={TWO} speechKey={KEY} me="gmotyl" />);
    fireEvent.focus(marker());
    const [first, second] = within(dialog()).getAllByRole("button", { name: /^Play comment by / });
    fireEvent.click(first);
    expect(speech.speakDocument).toHaveBeenCalledWith({ key: `${KEY}/c/990`, text: `kwojcik:\n\n${ROOT.body}` });
    fireEvent.click(second);
    expect(speech.speakDocument).toHaveBeenLastCalledWith({ key: `${KEY}/c/991`, text: "gmotyl:\n\nIt does." });
  });

  it("CommentMarker Play all speaks the thread in order", () => {
    render(<CommentMarker thread={TWO} speechKey={KEY} me="gmotyl" />);
    fireEvent.focus(marker());
    fireEvent.click(within(dialog()).getByRole("button", { name: "Play all comments on line 14" }));
    expect(speech.speakDocument).toHaveBeenCalledTimes(1);
    expect(speech.speakDocument).toHaveBeenCalledWith({
      key: `${KEY}/t/990`,
      text: `kwojcik:\n\n${ROOT.body}\n\ngmotyl:\n\nIt does.`,
    });
  });

  it("CommentMarker Play all speaks two conversations on a line one after the other, each with its replies", () => {
    const OTHER = comment({ id: 995, author: "ajanik", body: "Unrelated nit.", createdAt: "2026-11-23T10:30:00Z" });
    const OTHER_REPLY = comment({ id: 996, replyTo: 995, author: "mnowak", body: "Fixed.", createdAt: "2026-11-23T11:30:00Z" });
    // groupThreads sorts by time: the two conversations interleave.
    render(<CommentMarker thread={thread([ROOT, OTHER, REPLY, OTHER_REPLY])} speechKey={KEY} />);
    fireEvent.focus(marker());
    fireEvent.click(within(dialog()).getByRole("button", { name: "Play all comments on line 14" }));
    expect(speech.speakDocument).toHaveBeenCalledTimes(1);
    expect(speech.speakDocument).toHaveBeenCalledWith({
      key: `${KEY}/t/990`,
      text: `kwojcik:\n\n${ROOT.body}\n\ngmotyl:\n\nIt does.\n\najanik:\n\nUnrelated nit.\n\nmnowak:\n\nFixed.`,
    });
  });

  it("CommentMarker one-comment thread has a single Play, speaking the thread", () => {
    render(<CommentMarker thread={thread([ROOT])} speechKey={KEY} />);
    fireEvent.focus(marker());
    const pop = dialog();
    // Its name is the one comment it reads, and holds the visible "Play" (WCAG 2.5.3).
    const play = within(pop).getByRole("button", { name: "Play comment by kwojcik" });
    expect(play).toHaveTextContent(/^Play$/);
    expect(play).not.toHaveTextContent("Play all");
    expect(within(pop).getAllByRole("button", { name: /^Play/ })).toHaveLength(1);
    fireEvent.click(play);
    expect(speech.speakDocument).toHaveBeenCalledWith({ key: `${KEY}/t/990`, text: `kwojcik:\n\n${ROOT.body}` });
  });

  it("CommentMarker Play names hold their visible text and tell the comments apart", () => {
    host.states.set(`${KEY}/t/990`, "paused");
    render(<CommentMarker thread={TWO} speechKey={KEY} me="gmotyl" />);
    fireEvent.focus(marker());
    const all = screen.getByTestId("comment-play-thread");
    expect(all).toHaveTextContent("Resume");
    expect(all).toHaveAccessibleName("Resume all comments on line 14");
    // Named as the popover shows the author: "you" for the signed-in login.
    expect(screen.getByTestId("comment-play-990")).toHaveAccessibleName("Play comment by kwojcik");
    expect(screen.getByTestId("comment-play-991")).toHaveAccessibleName("Play comment by you");
  });

  // Each Play reads its own key's run off the host, as the page's speech row does.
  it.each([
    ["empty", "Play comment by gmotyl", "play", undefined],
    ["ready", "Play comment by gmotyl", "play", undefined],
    ["heard", "Play comment by gmotyl", "play", undefined],
    ["preparing", "Play comment by gmotyl — waiting for the voice", "play", "preparing"],
    ["stalled", "Pause comment by gmotyl — waiting for the voice", "pause", "stalled"],
    ["speaking", "Pause comment by gmotyl", "pause", "speaking"],
    ["paused", "Resume comment by gmotyl", "resume", "paused"],
  ])("CommentMarker comment Play while its key is %s reads %s", (state, label, icon, lit) => {
    host.states.set(`${KEY}/c/991`, state);
    render(<CommentMarker thread={TWO} speechKey={KEY} />);
    fireEvent.focus(marker());
    const button = screen.getByTestId("comment-play-991");
    expect(button).toHaveAccessibleName(label);
    expect(button).toHaveAttribute("data-icon", icon);
    expect(button).toHaveClass("speech-bar-primary");
    if (lit) expect(button).toHaveAttribute("data-speech", lit);
    else expect(button).not.toHaveAttribute("data-speech");
    // Only its own key: the other comment and the thread stay idle.
    expect(screen.getByTestId("comment-play-990")).toHaveAccessibleName("Play comment by kwojcik");
    expect(screen.getByTestId("comment-play-thread")).toHaveAccessibleName("Play all comments on line 14");
  });

  it("CommentMarker shows the red pause while the run waits on synthesis, then the pause once audio plays", () => {
    const key = `${KEY}/t/990`;
    const { rerender } = render(<CommentMarker thread={TWO} speechKey={KEY} />);
    fireEvent.focus(marker());
    fireEvent.click(screen.getByTestId("comment-play-thread"));
    expect(speech.speakDocument).toHaveBeenCalledTimes(1);
    // The host's run starts before unit 0 is in hand: `stalled`, the speech row's red.
    host.states.set(key, "stalled");
    rerender(<CommentMarker thread={TWO} speechKey={KEY} />);
    const play = screen.getByTestId("comment-play-thread");
    expect(play).toHaveAttribute("data-speech", "stalled");
    expect(play).toHaveAttribute("data-icon", "pause");
    expect(play).toHaveTextContent("Pause");
    host.states.set(key, "speaking");
    rerender(<CommentMarker thread={TWO} speechKey={KEY} />);
    expect(play).toHaveAttribute("data-speech", "speaking");
    expect(play).toHaveAccessibleName("Pause all comments on line 14");
    host.states.set(key, "heard");
    rerender(<CommentMarker thread={TWO} speechKey={KEY} />);
    expect(play).not.toHaveAttribute("data-speech");
    expect(play).toHaveAccessibleName("Play all comments on line 14");
    expect(play).toHaveTextContent("Play all");
  });

  it("CommentMarker Pause pauses its key's run and Resume resumes it, starting nothing new", () => {
    host.states.set(`${KEY}/c/990`, "speaking");
    host.states.set(`${KEY}/t/990`, "paused");
    const { rerender } = render(<CommentMarker thread={TWO} speechKey={KEY} />);
    fireEvent.focus(marker());
    fireEvent.click(screen.getByTestId("comment-play-990"));
    expect(host.onPause).toHaveBeenCalledWith(`${KEY}/c/990`);
    fireEvent.click(screen.getByTestId("comment-play-thread"));
    expect(host.onResume).toHaveBeenCalledWith(`${KEY}/t/990`);
    expect(speech.speakDocument).not.toHaveBeenCalled();
    // Waiting on synthesis is a run in hand too: its press pauses.
    host.states.set(`${KEY}/c/991`, "stalled");
    rerender(<CommentMarker thread={TWO} speechKey={KEY} />);
    fireEvent.click(screen.getByTestId("comment-play-991"));
    expect(host.onPause).toHaveBeenLastCalledWith(`${KEY}/c/991`);
  });

  it("CommentMarker closing the popover keeps its comment playing and reopening shows the run", () => {
    const { unmount } = render(<CommentMarker thread={TWO} speechKey={KEY} />);
    fireEvent.pointerEnter(marker(), { pointerType: "mouse" });
    fireEvent.click(screen.getByTestId("comment-play-990"));
    host.states.set(`${KEY}/c/990`, "speaking");
    fireEvent.pointerLeave(marker(), { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(speech.stopDocument).not.toHaveBeenCalled();
    fireEvent.pointerEnter(marker(), { pointerType: "mouse" });
    expect(screen.getByTestId("comment-play-990")).toHaveAccessibleName("Pause comment by kwojcik");
    unmount();
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
    act(() => within(dialog()).getByRole("button", { name: "Play all comments on line 14" }).focus());
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
    const play = within(dialog()).getByRole("button", { name: "Play all comments on line 14" });
    act(() => play.focus());
    tab(true);
    expect(document.activeElement).toBe(marker());
  });

  it("CommentMarker Tab off the last control skips hidden controls after the marker", () => {
    render(
      <div>
        <CommentMarker thread={TWO} speechKey={KEY} />
        <button type="button" hidden data-testid="hidden-attr">
          hidden
        </button>
        <div style={{ display: "none" }}>
          <button type="button" data-testid="in-display-none">
            in display none
          </button>
        </div>
        <fieldset disabled>
          <a href="https://example.com" data-testid="in-disabled-fieldset">
            x
          </a>
        </fieldset>
        <div inert>
          <button type="button" data-testid="inert">
            inert
          </button>
        </div>
        <button type="button" data-testid="after">
          after
        </button>
      </div>,
    );
    act(() => marker().focus());
    act(() => within(dialog()).getByRole("link", { name: "Reply on GitHub ↗" }).focus());
    tab();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("after"));
  });

  it("CommentMarker Tab off the last control with only hidden controls after lands on the closed marker", () => {
    render(
      <div>
        <CommentMarker thread={TWO} speechKey={KEY} />
        <button type="button" hidden>
          hidden
        </button>
        <div style={{ display: "none" }}>
          <button type="button">in display none</button>
        </div>
      </div>,
    );
    act(() => marker().focus());
    act(() => within(dialog()).getByRole("link", { name: "Reply on GitHub ↗" }).focus());
    tab();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(marker());
  });

  it("CommentMarker Tab off the last control falls back to the marker when focus does not take", () => {
    render(<Inline />);
    const after = screen.getByTestId("after");
    // A control the browser refuses to focus (e.g. hidden by layout jsdom cannot see).
    after.focus = () => {};
    act(() => marker().focus());
    act(() => within(dialog()).getByRole("link", { name: "Reply on GitHub ↗" }).focus());
    tab();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(marker());
  });

  it("CommentMarker reply links only to http(s) urls", () => {
    render(<CommentMarker thread={thread([comment({ url: "javascript:alert(1)" })])} speechKey={KEY} />);
    fireEvent.focus(marker());
    const pop = dialog();
    expect(pop).toHaveTextContent("Reply on GitHub");
    expect(pop).not.toHaveTextContent("↗");
    expect(within(pop).queryByRole("link")).toBeNull();
    expect(pop.querySelector("a")).toBeNull();
    expect(pop.querySelector("footer")).toHaveTextContent(/^Read-only$/);
  });
});
