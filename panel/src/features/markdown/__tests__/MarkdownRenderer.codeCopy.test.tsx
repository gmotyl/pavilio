import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MarkdownRenderer from "../MarkdownRenderer";
import { copyToClipboard } from "../../../lib/clipboard";

// The clipboard helper is the seam: it already owns the secure-context choice
// and the `execCommand` fallback that makes copying work over plain HTTP on the
// LAN, so what this file pins down is only *what text* reaches it.
vi.mock("../../../lib/clipboard", () => ({
  copyToClipboard: vi.fn(),
}));

// mermaid pulls in a browser-only rendering stack; the wiring under test is
// whether the code-fence override runs at all, not what mermaid draws.
vi.mock("../MermaidDiagram", () => ({
  default: ({ chart }: { chart: string }) => <div data-testid="mermaid">{chart}</div>,
}));

const copy = vi.mocked(copyToClipboard);

const twoFences = ["```ts", "const a = 1;", "```", "", "```sh", "ls -la", "```", ""].join("\n");

function renderMd(content: string) {
  return render(
    <MemoryRouter>
      <MarkdownRenderer content={content} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  copy.mockReset();
  copy.mockResolvedValue(true);
});

describe("MarkdownRenderer code block copy", () => {
  it("every fenced block gets a copy button", () => {
    const { container } = renderMd(twoFences);

    const buttons = screen.getAllByLabelText("Copy code");
    expect(buttons).toHaveLength(2);
    expect(container.querySelectorAll(".code-block")).toHaveLength(2);

    for (const button of buttons) {
      const wrapper = button.closest(".code-block");
      expect(wrapper).toBeTruthy();
      expect(wrapper!.querySelector("pre")).toBeTruthy();
    }
  });

  it("clicking copies the block's text without the fence", async () => {
    renderMd(twoFences);

    const [first] = screen.getAllByLabelText("Copy code");
    fireEvent.click(first);

    await waitFor(() => expect(copy).toHaveBeenCalledTimes(1));
    // No fence, no language class, and the fence's own trailing newline gone.
    expect(copy).toHaveBeenCalledWith("const a = 1;");
    // The existing CopyIconButton flips to a check for 1.5s on success.
    await waitFor(() => expect(first.querySelector(".lucide-check")).toBeTruthy());
  });

  it("a CRLF document copies its own line endings, with no stray trailing CR", async () => {
    // A note written on Windows reaches the panel with CRLF endings. The trim
    // in the `pre` override strips ONE trailing "\n" — the newline
    // `mdast-util-to-hast` appends — so the pasted text must keep its internal
    // "\r\n" pairs and must not end in a widowed "\r": a copied command with a
    // trailing CR is pasted into a shell as a broken line.
    renderMd("```sh\r\ncd /tmp\r\nls -la\r\n```\r\n");

    fireEvent.click(screen.getByLabelText("Copy code"));

    await waitFor(() => expect(copy).toHaveBeenCalledTimes(1));
    const copied = copy.mock.calls[0]![0] as string;
    expect(copied).toBe("cd /tmp\r\nls -la");
    expect(copied.endsWith("\r")).toBe(false);
    expect(copied.endsWith("\n")).toBe(false);
  });

  it("a fence with no language still gets a button and copies correctly", async () => {
    // The override keys off the `pre`, not off a `language-*` class, so an
    // unlabelled fence — the common case in a hand-written note — must behave
    // exactly like a labelled one. It is also the one fence whose child carries
    // no className at all, which is what the mermaid checks above read.
    const { container } = renderMd(["```", "plain text", "```", ""].join("\n"));

    expect(container.querySelectorAll(".code-block")).toHaveLength(1);
    expect(container.querySelector("pre > code")).not.toHaveAttribute("class");

    fireEvent.click(screen.getByLabelText("Copy code"));

    await waitFor(() => expect(copy).toHaveBeenCalledTimes(1));
    expect(copy).toHaveBeenCalledWith("plain text");
  });

  it("mermaid blocks have no copy button", async () => {
    renderMd(["```mermaid", "flowchart TD", "  A --> B", "```", ""].join("\n"));

    await waitFor(() => expect(screen.getByTestId("mermaid")).toBeTruthy());
    expect(screen.queryByLabelText("Copy code")).toBeNull();
    expect(screen.queryByLabelText("Copy")).toBeNull();
  });

  it("inline code gets a copy chip", () => {
    const { container } = renderMd("Turn on `mode 2004` first.\n");

    const chip = screen.getByLabelText("Copy");
    // The chip rides on the span itself, inside an inline wrapper, so the
    // sentence keeps flowing around it; it is not a fenced block's button.
    const wrap = chip.closest(".inline-code-wrap")!;
    expect(wrap).toBeTruthy();
    expect(wrap.tagName).toBe("SPAN");
    expect(wrap.querySelector("code")).toHaveTextContent("mode 2004");
    expect(container.querySelector(".code-block")).toBeNull();
    expect(screen.queryByLabelText("Copy code")).toBeNull();
  });

  it("inline copy chip copies the span text", async () => {
    renderMd("Turn on `mode 2004` first.\n");

    fireEvent.click(screen.getByLabelText("Copy"));

    await waitFor(() => expect(copy).toHaveBeenCalledTimes(1));
    expect(copy).toHaveBeenCalledWith("mode 2004");
  });

  it("code inside a fenced block gets no inline chip", () => {
    // A fence's `code` goes through the same override as an inline span; only
    // the fence's own button may land inside the `.code-block`.
    const { container } = renderMd(["```", "plain text", "```", ""].join("\n"));

    const block = container.querySelector(".code-block")!;
    expect(block.querySelectorAll("button")).toHaveLength(1);
    expect(container.querySelector(".inline-code-wrap")).toBeNull();
    expect(screen.queryByLabelText("Copy")).toBeNull();
  });

  it("an empty fence gets no inline chip", () => {
    // An empty fence's `code` holds no text at all — not even the trailing
    // newline a filled fence carries — so the text cannot tell it from a code
    // span. Its `pre` can: with or without a language, the fence keeps its one
    // button and nothing inside it is an inline chip.
    for (const fence of [["```", "```", ""], ["```ts", "```", ""]]) {
      const { container, unmount } = renderMd(fence.join("\n"));

      const block = container.querySelector(".code-block")!;
      expect(block).toBeTruthy();
      expect(block.querySelectorAll("button")).toHaveLength(1);
      expect(container.querySelector(".inline-code-wrap")).toBeNull();
      expect(screen.queryByLabelText("Copy")).toBeNull();
      unmount();
    }
  });

  it("raw pre code gets no inline chip", () => {
    // rehype-raw turns HTML in the note into real elements, and a one-line
    // `<pre><code>` has no newline in it either. It is a block all the same.
    const { container } = renderMd("<pre><code>one line</code></pre>\n");

    const block = container.querySelector(".code-block")!;
    expect(block).toBeTruthy();
    expect(block.querySelectorAll("button")).toHaveLength(1);
    expect(container.querySelector(".inline-code-wrap")).toBeNull();
    expect(screen.queryByLabelText("Copy")).toBeNull();
    // The marker that tells the two apart is a prop, never an attribute.
    expect(container.querySelector("code")).not.toHaveAttribute("data-block");
  });

  it("the inline chip inside a link does not follow it", async () => {
    function Where() {
      return <div data-testid="where">{useLocation().pathname}</div>;
    }
    // A relative link with a basePath goes through the in-app `a` override,
    // whose click handler navigates; the chip must reach neither it nor the
    // browser's own link activation.
    render(
      <MemoryRouter initialEntries={["/start"]}>
        <MarkdownRenderer content={"See [`mode 2004`](other.md).\n"} basePath="proj/NOTE.md" />
        <Where />
      </MemoryRouter>,
    );

    const chip = screen.getByLabelText("Copy");
    expect(chip.closest("a")).toBeTruthy();
    // `fireEvent` returns false when a handler called `preventDefault()`.
    expect(fireEvent.click(chip)).toBe(false);

    await waitFor(() => expect(copy).toHaveBeenCalledWith("mode 2004"));
    expect(screen.getByTestId("where")).toHaveTextContent("/start");
  });

  it("the button is a sibling of the pre, not inside it", () => {
    // Nothing inside the fence is a stable anchor: a highlighted fence scrolls
    // wide code inside the `code` (`pre code.hljs` is `display: block` +
    // `overflow-x: auto`), and an unlabelled one scrolls the `pre` itself
    // (`overflow-x: auto` from `@tailwindcss/typography`). The button is
    // anchored to the `.code-block` wrapper, which scrolls in neither case —
    // that is the structure this test pins down.
    const { container } = renderMd(["```ts", "const a = 1;", "```", ""].join("\n"));

    const button = screen.getByLabelText("Copy code");
    const pre = container.querySelector("pre")!;

    expect(pre.contains(button)).toBe(false);
    expect(button.parentElement).toBe(pre.parentElement);
    expect(button.parentElement).toHaveClass("code-block");
  });
});
