import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";

vi.mock("../../realtime/useWebSocket", () => ({
  useWebSocket: () => ({ lastMessage: null }),
}));

/** Mount/unmount counters per project — a remount means an xterm replay. */
const surface = vi.hoisted(() => ({
  mounts: [] as string[],
  unmounts: [] as string[],
}));

vi.mock("../../terminal/ProjectTerminalsSurface", () => ({
  default: function MockSurface({ projectName }: { projectName: string }) {
    useEffect(() => {
      surface.mounts.push(projectName);
      return () => {
        surface.unmounts.push(projectName);
      };
    }, [projectName]);
    return <div data-testid="terminals-surface">{projectName}</div>;
  },
}));

import ProjectView from "../ProjectView";
import { refreshProjects } from "../useProjects";

interface Deferred {
  resolve: (r: Response) => void;
}

/** Per-name answer of `GET /api/projects/:name`: archived flag, 404, or held open. */
let details: Record<string, { archived: boolean } | "404" | "hold">;
/** Names `GET /api/projects` lists. */
let listed: string[];
/** Detail requests held open by "hold", oldest first, with their name. */
let held: { name: string; deferred: Deferred }[];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

function project(name: string, archived: boolean) {
  return {
    name,
    path: `/p/projects/${archived ? "archived/" : ""}${name}`,
    hasIndex: true,
    hasNotes: true,
    hasProgress: false,
    hasPlans: false,
    hasWiki: false,
    latestProgressDate: null,
    kind: "client",
    lastActivity: null,
    repos: [],
    archived,
    ...(archived ? { archivedAt: "2026-09-02T10:00:00" } : {}),
  };
}

beforeEach(() => {
  surface.mounts.length = 0;
  surface.unmounts.length = 0;
  details = {};
  listed = [];
  held = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = String(input);
      if (url === "/api/projects") return json(listed.map((n) => project(n, false)));
      const m = url.match(/^\/api\/projects\/([^/]+)$/);
      if (m) {
        const name = decodeURIComponent(m[1]);
        const answer = details[name] ?? "404";
        if (answer === "404") return json({ error: "not found" }, 404);
        if (answer === "hold") {
          return new Promise<Response>((resolve) => held.push({ name, deferred: { resolve } }));
        }
        return json(project(name, answer.archived));
      }
      if (url === "/api/archive") return json([]);
      if (url.startsWith("/api/scripts")) return json({ scripts: [] });
      if (url.startsWith("/api/files/index")) return json([]);
      return json({}, 404);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

let navigate: (to: string) => void = () => {};
function NavigateProbe() {
  navigate = useNavigate();
  return null;
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/project/:name" element={<ProjectView />} />
        <Route path="/project/:name/:section" element={<ProjectView />} />
      </Routes>
      <NavigateProbe />
    </MemoryRouter>,
  );
}

/** Let pending fetches and their state updates land. */
const flush = () => act(async () => {
  await new Promise((r) => setTimeout(r, 20));
});

describe("ProjectView — iterm surface gate", () => {
  it("never mounts the surface for an archived project, even with a slow detail fetch", async () => {
    details.old = "hold";
    renderAt("/project/old/iterm");
    await flush();
    expect(surface.mounts).toEqual([]);

    await act(async () => {
      held[0].deferred.resolve(json(project("old", true)));
    });
    await screen.findByTestId("archived-banner");
    await flush();
    expect(surface.mounts).toEqual([]);
  });

  it("mounts the surface once for a live project", async () => {
    listed = ["live"];
    details.live = { archived: false };
    renderAt("/project/live/iterm");
    await screen.findByTestId("terminals-surface");
    await flush();
    expect(surface.mounts).toEqual(["live"]);
    expect(surface.unmounts).toEqual([]);
  });

  it("does not remount when a refetch transiently omits the project", async () => {
    listed = ["live"];
    // PROJECT.md missing mid-checkout: the detail lookup cannot find it either.
    details.live = "hold";
    renderAt("/project/live/iterm");
    await screen.findByTestId("terminals-surface");
    await flush();
    expect(surface.mounts).toEqual(["live"]);

    listed = [];
    await act(async () => refreshProjects());
    await flush();
    expect(surface.unmounts).toEqual([]);

    // The file comes back, the list picks it up again.
    listed = ["live"];
    await act(async () => refreshProjects());
    await flush();
    expect(surface.mounts).toEqual(["live"]);
    expect(surface.unmounts).toEqual([]);
    expect(screen.getByTestId("terminals-surface")).toBeTruthy();
  });

  it("mounts the surface for an unknown name that is not archived (detail 404)", async () => {
    renderAt("/project/session-label/iterm");
    await screen.findByTestId("terminals-surface");
    expect(surface.mounts).toEqual(["session-label"]);
  });

  it("unmounts the surface when the project turns out archived", async () => {
    listed = ["live"];
    details.live = { archived: true };
    renderAt("/project/live/iterm");
    await screen.findByTestId("terminals-surface");

    listed = [];
    await act(async () => refreshProjects());
    await screen.findByTestId("archived-banner");
    await waitFor(() => expect(screen.queryByTestId("terminals-surface")).toBeNull());
    expect(surface.unmounts).toEqual(["live"]);
  });
});

describe("ProjectView — stale detail fetch", () => {
  it("a slow archived answer for the previous project does not mark the next one archived", async () => {
    details.old = "hold";
    details.next = "hold";
    renderAt("/project/old");
    await flush();
    expect(held.map((h) => h.name)).toEqual(["old"]);

    await act(async () => navigate("/project/next"));
    await flush();
    // The previous project's answer lands while the next one's is in flight.
    await act(async () => {
      held[0].deferred.resolve(json(project("old", true)));
    });
    await flush();
    expect(screen.queryByTestId("archived-banner")).toBeNull();

    const nextReq = held.find((h) => h.name === "next")!;
    await act(async () => {
      nextReq.deferred.resolve(json(project("next", false)));
    });
    await flush();
    expect(screen.queryByTestId("archived-banner")).toBeNull();
  });

  it("an archived project's detail does not carry over to the next project", async () => {
    details.old = { archived: true };
    details.next = "hold";
    renderAt("/project/old");
    await screen.findByTestId("archived-banner");

    await act(async () => navigate("/project/next"));
    await flush();
    // `next` is still loading: nothing about it is known, least of all "archived".
    expect(screen.queryByTestId("archived-banner")).toBeNull();
  });

  it("switching to an unlisted project's iterm holds the surface until its detail answers", async () => {
    listed = ["live"];
    details.old = "hold";
    renderAt("/project/live/iterm");
    await screen.findByTestId("terminals-surface");

    await act(async () => navigate("/project/old/iterm"));
    await flush();
    expect(surface.mounts).toEqual(["live"]);
    expect(screen.queryByTestId("terminals-surface")).toBeNull();

    await act(async () => {
      held.find((h) => h.name === "old")!.deferred.resolve(json(project("old", true)));
    });
    await flush();
    expect(surface.mounts).toEqual(["live"]);
  });
});
