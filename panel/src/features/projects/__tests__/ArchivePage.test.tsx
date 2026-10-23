import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetPreferenceStoreForTests } from "../../../preferences/store";
import { ArchivePage } from "../ArchivePage";

const ROWS = [
  {
    name: "graph-rag-vs-kg",
    archivedAt: "2026-10-20T10:00:00",
    kind: "research",
    description: "How agentic GraphRAG differs from a plain knowledge graph.",
  },
  {
    name: "shop-revamp",
    archivedAt: "2026-10-05T10:00:00",
    kind: "project",
    description: "Storefront rebuild, paused after the Q3 freeze.",
  },
  {
    name: "knowledge",
    archivedAt: "2026-08-14T10:00:00",
    kind: "knowledge",
    description: null,
  },
  {
    name: "perfume",
    archivedAt: "2025-09-30T10:00:00",
    kind: "project",
    description: "Old pilot.",
  },
];

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/archive"]}>
      <Routes>
        <Route path="/archive" element={<ArchivePage />} />
        <Route path="*" element={null} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

async function renderLoaded() {
  renderPage();
  await screen.findByTestId("archive-row-graph-rag-vs-kg");
}

beforeEach(() => {
  // Only Date is faked so waitFor's timers still run. Thursday 2026-10-22.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 22, 15, 0, 0));
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => jsonResponse(ROWS));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
  __resetPreferenceStoreForTests();
});

function visibleRowNames() {
  return screen
    .queryAllByTestId(/^archive-row-/)
    .map((el) => el.getAttribute("data-testid")!.replace("archive-row-", ""));
}

describe("ArchivePage", () => {
  it("kind switch filters and counts, knowledge as research", async () => {
    await renderLoaded();
    const all = screen.getByTestId("archive-kind-all");
    const projects = screen.getByTestId("archive-kind-project");
    const research = screen.getByTestId("archive-kind-research");
    expect(all.textContent).toMatch(/All\s*4/);
    expect(projects.textContent).toMatch(/Projects\s*2/);
    expect(research.textContent).toMatch(/Research\s*2/);
    expect(all.getAttribute("aria-pressed")).toBe("true");

    // Group headers, newest first, empty groups hidden.
    expect(
      screen.getAllByTestId("archive-group").map((g) => g.getAttribute("data-label")),
    ).toEqual(["This week", "This month", "August 2026", "2025"]);

    fireEvent.click(research);
    expect(research.getAttribute("aria-pressed")).toBe("true");
    expect(visibleRowNames()).toEqual(["graph-rag-vs-kg", "knowledge"]);

    fireEvent.click(projects);
    expect(visibleRowNames()).toEqual(["shop-revamp", "perfume"]);

    fireEvent.click(all);
    expect(visibleRowNames()).toHaveLength(4);
  });

  it("search matches name and description and highlights", async () => {
    await renderLoaded();
    const search = screen.getByPlaceholderText(/search archived names and descriptions/i);

    fireEvent.change(search, { target: { value: "RAG" } });
    // One row hits in both its name and its description; every hit is marked.
    expect(visibleRowNames()).toEqual(["graph-rag-vs-kg"]);
    const row = screen.getByTestId("archive-row-graph-rag-vs-kg");
    const marks = within(row).getAllByTestId("archive-hit").map((m) => m.textContent);
    expect(marks).toEqual(["rag", "RAG"]);

    // Description-only match.
    fireEvent.change(search, { target: { value: "freeze" } });
    expect(visibleRowNames()).toEqual(["shop-revamp"]);
    expect(
      within(screen.getByTestId("archive-row-shop-revamp")).getByTestId("archive-hit").textContent,
    ).toBe("freeze");

    fireEvent.change(search, { target: { value: "zzz" } });
    expect(visibleRowNames()).toEqual([]);
    expect(screen.getByText("No matches.")).toBeTruthy();
  });

  it("row shows name, description, archived date, Restore, no stats, no Ask", async () => {
    await renderLoaded();
    const row = screen.getByTestId("archive-row-graph-rag-vs-kg");
    expect(within(row).getByTestId("project-mark-icon-flask")).toBeTruthy();
    expect(within(row).getByText("graph-rag-vs-kg")).toBeTruthy();
    expect(
      within(row).getByText("How agentic GraphRAG differs from a plain knowledge graph."),
    ).toBeTruthy();
    expect(within(row).getByText("archived 2026-10-20")).toBeTruthy();
    const restore = within(row).getByTestId("archive-restore-graph-rag-vs-kg");
    expect(restore.textContent).toContain("Restore");
    // Restore is the row's last element: it sits on the right.
    expect(row.lastElementChild).toBe(restore);

    // Agreed deviations: no wiki/source stats and no Ask control.
    expect(row.textContent).not.toMatch(/pages|sources/);
    expect(within(row).queryByRole("button", { name: /ask/i })).toBeNull();
    expect(row.textContent).not.toMatch(/\bAsk\b/);

    // A row without a description renders without one.
    const knowledge = screen.getByTestId("archive-row-knowledge");
    expect(within(knowledge).getByTestId("project-mark-icon-book")).toBeTruthy();
    expect(within(knowledge).queryByTestId("archive-description")).toBeNull();
  });

  it("row links to wiki for research, overview for projects", async () => {
    await renderLoaded();
    expect(screen.getByTestId("archive-link-graph-rag-vs-kg").getAttribute("href")).toBe(
      "/project/graph-rag-vs-kg/wiki",
    );
    expect(screen.getByTestId("archive-link-knowledge").getAttribute("href")).toBe(
      "/project/knowledge/wiki",
    );
    expect(screen.getByTestId("archive-link-shop-revamp").getAttribute("href")).toBe(
      "/project/shop-revamp",
    );

    fireEvent.click(screen.getByTestId("archive-link-graph-rag-vs-kg"));
    expect(screen.getByTestId("location").textContent).toBe("/project/graph-rag-vs-kg/wiki");
  });

  it("Restore does not navigate", async () => {
    await renderLoaded();
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? jsonResponse({ ok: true })
        : jsonResponse(ROWS.filter((r) => r.name !== "shop-revamp")),
    );
    fireEvent.click(screen.getByTestId("archive-restore-shop-revamp"));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/archive/shop-revamp/restore", {
        method: "POST",
      }),
    );
    await waitFor(() => expect(screen.queryByTestId("archive-row-shop-revamp")).toBeNull());
    expect(screen.getByTestId("location").textContent).toBe("/archive");
  });

  it("restore error shows inline", async () => {
    await renderLoaded();
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? jsonResponse({ error: "target exists" }, 409)
        : jsonResponse(ROWS),
    );
    fireEvent.click(screen.getByTestId("archive-restore-perfume"));
    expect((await screen.findByTestId("archive-error")).textContent).toContain("target exists");
    expect(screen.getByTestId("location").textContent).toBe("/archive");
  });

  it("highlight stays aligned when lower-casing changes the text length", async () => {
    // "İ".toLowerCase() is two code units, which used to shift every later mark.
    fetchMock.mockImplementation(() =>
      jsonResponse([
        {
          name: "izmir-pilot",
          archivedAt: "2026-10-20T10:00:00",
          kind: "project",
          description: "İzmir pilot on RAG retrieval",
        },
      ]),
    );
    renderPage();
    await screen.findByTestId("archive-row-izmir-pilot");
    fireEvent.change(screen.getByPlaceholderText(/search archived names and descriptions/i), {
      target: { value: "rag" },
    });
    const row = screen.getByTestId("archive-row-izmir-pilot");
    expect(within(row).getAllByTestId("archive-hit").map((m) => m.textContent)).toEqual(["RAG"]);
    expect(within(row).getByTestId("archive-description").textContent).toBe(
      "İzmir pilot on RAG retrieval",
    );
  });
});
