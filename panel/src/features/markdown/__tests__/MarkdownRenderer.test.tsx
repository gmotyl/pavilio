import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import MarkdownRenderer from "../MarkdownRenderer";

// mermaid pulls in a browser-only rendering stack; the wiring under test is
// whether the code-fence override runs at all, not what mermaid draws.
vi.mock("../MermaidDiagram", () => ({
  default: ({ chart }: { chart: string }) => <div data-testid="mermaid">{chart}</div>,
}));

const doc = ["# Title", "", "```mermaid", "flowchart TD", "  A --> B", "```", ""].join("\n");

function renderMd(props: { content: string; basePath?: string }) {
  return render(
    <MemoryRouter>
      <MarkdownRenderer {...props} />
    </MemoryRouter>,
  );
}

describe("MarkdownRenderer mermaid fences", () => {
  it("renders a diagram for a file inside projectsDir", async () => {
    renderMd({ content: doc, basePath: "metro/plans/design.md" });
    await waitFor(() => expect(screen.getByTestId("mermaid")).toBeTruthy());
  });

  it("renders a diagram when there is no basePath", async () => {
    // A design doc in an OpenSpec backend outside projectsDir resolves to no
    // relative path. It used to fall through to a plain <pre><code> block.
    renderMd({ content: doc });
    await waitFor(() => expect(screen.getByTestId("mermaid")).toBeTruthy());
  });

  it("passes the fence body through as the chart", async () => {
    renderMd({ content: doc });
    await waitFor(() => {
      expect(screen.getByTestId("mermaid").textContent).toBe("flowchart TD\n  A --> B");
    });
  });

  it("still renders non-mermaid fences as code, with or without a basePath", () => {
    const ts = ["```ts", "const a = 1;", "```", ""].join("\n");
    const { container, unmount } = renderMd({ content: ts });
    expect(container.querySelector("pre code")).toBeTruthy();
    expect(container.querySelector("[data-testid=mermaid]")).toBeNull();
    unmount();

    const withBase = renderMd({ content: ts, basePath: "metro/plans/design.md" });
    expect(withBase.container.querySelector("pre code")).toBeTruthy();
  });
});
