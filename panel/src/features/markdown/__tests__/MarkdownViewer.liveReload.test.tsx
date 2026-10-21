import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let lastMessage: { type: string; path?: string } | null = null;
vi.mock("../../realtime/useWebSocket", () => ({
  useWebSocket: () => ({ lastMessage }),
}));
vi.mock("../MermaidDiagram", () => ({ default: () => null }));

import MarkdownViewer from "../MarkdownViewer";

let fetched: string[] = [];

beforeEach(() => {
  fetched = [];
  lastMessage = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      fetched.push(url);
      return new Response(JSON.stringify({ content: "# Hi", absolutePath: "/ws/projects/p/notes/a b.md" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const tree = () => (
  <MemoryRouter initialEntries={["/view/p/notes/a%20b%23c.md"]}>
    <Routes>
      <Route path="/view/*" element={<MarkdownViewer />} />
    </Routes>
  </MemoryRouter>
);

describe("MarkdownViewer with an encoded route", () => {
  it("reads the decoded file and live-reloads on its raw-path change", async () => {
    const { rerender } = render(tree());
    const read = "/api/files/read/p/notes/a%20b%23c.md";
    await waitFor(() => expect(fetched.filter((u) => u === read)).toHaveLength(1));

    lastMessage = { type: "file-change", path: "/ws/projects/p/notes/a b#c.md" };
    rerender(tree());
    await waitFor(() => expect(fetched.filter((u) => u === read)).toHaveLength(2));
  });
});
