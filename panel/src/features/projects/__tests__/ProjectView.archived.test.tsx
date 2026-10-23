import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("../../realtime/useWebSocket", () => ({
  useWebSocket: () => ({ lastMessage: null }),
}));

import ProjectView from "../ProjectView";

const NAME = "old-research";
const BANNER_TEXT = "Archived 2026-09-02 · read-only — no edits, no terminals start here";

/** `GET /api/projects/:name` for the project; `archived` flips when Restore is posted. */
let archived: boolean;
/** Whether the live list (`GET /api/projects`) carries the project. */
let listed: boolean;
let fetchMock: ReturnType<typeof vi.fn>;
/** `GET /api/files/index` rows. */
let indexRows: Array<{ relativePath: string; project: string; modified: number; archived: boolean }>;

function detail() {
  return {
    name: NAME,
    path: `/p/projects/${archived ? "archived/" : ""}${NAME}`,
    hasIndex: true,
    hasNotes: true,
    hasProgress: false,
    hasPlans: false,
    hasWiki: true,
    latestProgressDate: null,
    kind: "research",
    lastActivity: null,
    // Repos on disk still hide the tab while archived.
    repos: [{ name: "repo", path: "/r/repo" }],
    archived,
    ...(archived ? { archivedAt: "2026-09-02T10:00:00" } : {}),
  };
}

const EMPTY_WIKI = {
  project: NAME,
  overview: null,
  entities: { count: 0, kinds: [] },
  concepts: { count: 0, pages: [] },
  repos: { count: 0, repos: [] },
  interaction: { count: 0, openQuestions: null, openQuestionsCount: 0, notes: [], questions: [] },
  sources: { count: 0, kinds: [] },
  other: [],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

beforeEach(() => {
  archived = true;
  listed = false;
  indexRows = [];
  fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") {
      if (url === `/api/archive/${NAME}/restore`) {
        archived = false;
        return json({ ok: true });
      }
      return json({ error: "unexpected" }, 500);
    }
    // The live list never carries an archived project.
    if (url === "/api/projects") return json(listed ? [detail()] : []);
    if (url === `/api/projects/${NAME}`) return json(detail());
    if (url === `/api/projects/${NAME}/wiki`) return json(EMPTY_WIKI);
    if (url === "/api/archive") {
      return json(
        archived
          ? [{ name: NAME, archivedAt: "2026-09-02T10:00:00", kind: "research", description: null }]
          : [],
      );
    }
    if (url === `/api/files/read/${NAME}/PROJECT.md`) {
      return json({ content: "# Old research\n\nA finished topic.", absolutePath: "/p/PROJECT.md" });
    }
    if (url === `/api/files/read/${NAME}/wiki/concepts/graph.md`) {
      return json({ content: "# Graph\n\nDeep-linked page body.", absolutePath: "/p/graph.md" });
    }
    if (url.startsWith("/api/scripts")) return json({ scripts: [] });
    if (url.startsWith("/api/files/index")) return json(indexRows);
    return json({}, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/project/:name" element={<ProjectView />} />
        <Route path="/project/:name/:section" element={<ProjectView />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

/** Tab-bar links by target; the bar is the first set of links in the view. */
const tabLink = (to: string) =>
  screen.getByTestId("project-view").querySelector(`a[href="${to}"]`);

describe("ProjectView — archived project", () => {
  it("archived project renders banner with date and Restore", async () => {
    renderAt(`/project/${NAME}`);
    const banner = await screen.findByTestId("archived-banner");
    expect(banner.textContent).toContain(BANNER_TEXT);
    // Amber: the panel's yellow token, as the mockup's banner.
    expect(banner.getAttribute("style")).toContain("var(--yellow)");
    const restore = within(banner).getByTestId("archived-banner-restore");
    expect(restore.textContent).toBe("Restore to sidebar");

    // The normal tabs render below the banner.
    const overview = tabLink(`/project/${NAME}`);
    expect(overview).not.toBeNull();
    expect(
      banner.compareDocumentPosition(overview!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(tabLink(`/project/${NAME}/wiki`)).not.toBeNull();
    expect(tabLink(`/project/${NAME}/notes`)).not.toBeNull();
    expect(tabLink(`/project/${NAME}/iterm`)).toBeNull();
    expect(tabLink(`/project/${NAME}/repos`)).toBeNull();
    // The overview content still renders.
    expect(await screen.findByTestId("project-md")).toBeTruthy();
  });

  it("hidden tab URL redirects to overview", async () => {
    const first = renderAt(`/project/${NAME}/iterm`);
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(`/project/${NAME}`),
    );
    expect(await screen.findByTestId("archived-banner")).toBeTruthy();
    first.unmount();

    renderAt(`/project/${NAME}/repos`);
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(`/project/${NAME}`),
    );
  });

  it("restore turns the view live without changing the URL", async () => {
    renderAt(`/project/${NAME}/notes`);
    const banner = await screen.findByTestId("archived-banner");
    expect(tabLink(`/project/${NAME}/iterm`)).toBeNull();

    fireEvent.click(within(banner).getByTestId("archived-banner-restore"));

    await waitFor(() => expect(screen.queryByTestId("archived-banner")).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith(`/api/archive/${NAME}/restore`, { method: "POST" });
    // Data refetched: the detail endpoint answered again, now live.
    const detailCalls = fetchMock.mock.calls.filter(([u]) => u === `/api/projects/${NAME}`);
    expect(detailCalls.length).toBeGreaterThanOrEqual(2);
    expect(tabLink(`/project/${NAME}/iterm`)).not.toBeNull();
    expect(tabLink(`/project/${NAME}/repos`)).not.toBeNull();
    expect(screen.getByTestId("location").textContent).toBe(`/project/${NAME}/notes`);
  });

  it("wiki deep link opens in the archived view", async () => {
    const file = `${NAME}/wiki/concepts/graph.md`;
    const entry = `/project/${NAME}/wiki?file=${encodeURIComponent(file)}`;
    renderAt(entry);
    expect(await screen.findByTestId("archived-banner")).toBeTruthy();
    expect(await screen.findByText("Deep-linked page body.")).toBeTruthy();
    expect(screen.getByTestId("wiki-view")).toBeTruthy();
    // Not redirected: the wiki is one of the tabs an archived project keeps.
    expect(screen.getByTestId("location").textContent).toBe(entry);
  });

  it("a live project shows no banner", async () => {
    archived = false;
    listed = true;
    renderAt(`/project/${NAME}`);
    expect(await screen.findByTestId("project-md")).toBeTruthy();
    await waitFor(() => expect(tabLink(`/project/${NAME}/iterm`)).not.toBeNull());
    expect(screen.queryByTestId("archived-banner")).toBeNull();
  });

  it("section tabs list the archived project's files, not a live namesake's", async () => {
    indexRows = [
      { relativePath: `archived/${NAME}/notes/2026-09-01-kickoff.md`, project: NAME, modified: 2, archived: true },
      { relativePath: `archived/${NAME}/progress/2026-09-02-wrap.md`, project: NAME, modified: 1, archived: true },
      { relativePath: `${NAME}/notes/2026-10-01-live.md`, project: NAME, modified: 3, archived: false },
    ];
    const first = renderAt(`/project/${NAME}/notes`);
    expect(await screen.findByTestId("archived-banner")).toBeTruthy();
    expect(await screen.findByText("2026-09-01-kickoff.md")).toBeTruthy();
    expect(screen.queryByText("2026-10-01-live.md")).toBeNull();
    first.unmount();

    renderAt(`/project/${NAME}/progress`);
    expect(await screen.findByText("2026-09-02-wrap.md")).toBeTruthy();
  });
});
