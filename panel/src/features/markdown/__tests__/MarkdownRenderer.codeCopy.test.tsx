import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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

  it("mermaid blocks have no copy button", async () => {
    renderMd(["```mermaid", "flowchart TD", "  A --> B", "```", ""].join("\n"));

    await waitFor(() => expect(screen.getByTestId("mermaid")).toBeTruthy());
    expect(screen.queryByLabelText("Copy code")).toBeNull();
  });

  it("inline code has no copy button", () => {
    renderMd("A paragraph with `inline code` in it.\n");

    expect(screen.queryByLabelText("Copy code")).toBeNull();
  });

  it("the button is a sibling of the pre, not inside it", () => {
    // A button inside the `pre` would scroll out of the corner as soon as wide
    // code is scrolled sideways; it has to sit outside that scroll box.
    const { container } = renderMd(["```ts", "const a = 1;", "```", ""].join("\n"));

    const button = screen.getByLabelText("Copy code");
    const pre = container.querySelector("pre")!;

    expect(pre.contains(button)).toBe(false);
    expect(button.parentElement).toBe(pre.parentElement);
    expect(button.parentElement).toHaveClass("code-block");
  });
});
