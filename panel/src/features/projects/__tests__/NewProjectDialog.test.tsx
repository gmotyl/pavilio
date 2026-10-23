import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * The "new" dialog: opened from the **new** button on the Projects and
 * Research headers, it creates a project or a research project through
 * `POST /api/projects` and answers every response inline or by opening the new
 * project's terminals.
 */

const refreshProjects = vi.hoisted(() => vi.fn());

vi.mock("../../speech/useSpeechHost", () =>
  import("../../shell/__tests__/leftSidebar.harness").then((m) => m.mockShellDeps.useSpeechHost()),
);
vi.mock("../useProjects", () => ({
  useProjects: () => [],
  refreshProjects,
}));
vi.mock("../../terminal/useAllTerminalSessions", () =>
  import("../../shell/__tests__/leftSidebar.harness").then((m) =>
    m.mockShellDeps.useAllTerminalSessions(),
  ),
);
vi.mock("../useArchivedProjects", () =>
  import("../../shell/__tests__/leftSidebar.harness").then((m) =>
    m.mockShellDeps.useArchivedProjects(),
  ),
);
vi.mock("../useFavorites", () =>
  import("../../shell/__tests__/leftSidebar.harness").then((m) => m.mockShellDeps.useFavorites()),
);
vi.mock("../../mobile-access/useMobileAccessStatus", () =>
  import("../../shell/__tests__/leftSidebar.harness").then((m) =>
    m.mockShellDeps.useMobileAccessStatus(),
  ),
);
vi.mock("../../auto-sync/useAutoSyncStatus", () =>
  import("../../shell/__tests__/leftSidebar.harness").then((m) =>
    m.mockShellDeps.useAutoSyncStatus(),
  ),
);
vi.mock("../../git/useGitStatus", () =>
  import("../../shell/__tests__/leftSidebar.harness").then((m) => m.mockShellDeps.useGitStatus()),
);

import NewProjectDialog from "../NewProjectDialog";
import LeftSidebar from "../../shell/LeftSidebar";
import { TerminalSpeechHost } from "../../terminal/TerminalSpeechHost";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status: number) {
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

function renderDialog(
  props: Partial<Parameters<typeof NewProjectDialog>[0]> = {},
) {
  const onClose = props.onClose ?? vi.fn();
  const restore = props.restore ?? vi.fn(async () => null);
  render(
    <MemoryRouter initialEntries={["/"]}>
      <NewProjectDialog
        initialKind={props.initialKind ?? "project"}
        onClose={onClose}
        restore={restore}
      />
      <Routes>
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
  return { onClose, restore };
}

function typeTitle(value: string) {
  fireEvent.change(screen.getByTestId("new-project-title"), { target: { value } });
}

function typeTopic(value: string) {
  fireEvent.change(screen.getByTestId("new-project-topic"), { target: { value } });
}

async function clickCreate() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("new-project-create"));
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  refreshProjects.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("NewProjectDialog", () => {
  it("opens preselected by the header clicked", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <TerminalSpeechHost>
          <LeftSidebar />
        </TerminalSpeechHost>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("sidebar-section-research-new"));
    expect(screen.getByTestId("new-project-dialog")).toBeTruthy();
    expect(screen.getByTestId("new-project-kind-research").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("new-project-kind-project").getAttribute("aria-pressed")).toBe("false");
    const topic = screen.getByTestId("new-project-topic") as HTMLInputElement;
    expect(topic.required).toBe(true);

    fireEvent.click(screen.getByTestId("new-project-cancel"));
    expect(screen.queryByTestId("new-project-dialog")).toBeNull();

    fireEvent.click(screen.getByTestId("sidebar-section-projects-new"));
    expect(screen.getByTestId("new-project-kind-project").getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("new-project-topic")).toBeNull();
  });

  it("shows live folder slug", () => {
    renderDialog();
    typeTitle("Edge TTS voices");
    expect(screen.getByTestId("new-project-folder").textContent).toBe("folder: edge-tts-voices");
  });

  it("blocks create on invalid slug or missing topic", () => {
    renderDialog({ initialKind: "research" });
    const create = () => screen.getByTestId("new-project-create") as HTMLButtonElement;

    typeTitle("!!!");
    expect(screen.getByTestId("new-project-title-error").textContent).toMatch(/empty/i);
    expect(create().disabled).toBe(true);

    typeTitle("Archived");
    expect(screen.getByTestId("new-project-title-error").textContent).toMatch(/archived/i);
    expect(create().disabled).toBe(true);

    typeTitle("Edge TTS voices");
    expect(screen.queryByTestId("new-project-title-error")).toBeNull();
    typeTopic("x");
    typeTopic("  ");
    expect(screen.getByTestId("new-project-topic-error").textContent).toMatch(/topic/i);
    expect(create().disabled).toBe(true);

    typeTopic("Which voices read Polish well");
    expect(screen.queryByTestId("new-project-topic-error")).toBeNull();
    expect(create().disabled).toBe(false);
  });

  it("201 opens the new project's terminals", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ name: "edge-tts-voices" }, 201));
    const { onClose } = renderDialog({ initialKind: "research" });
    typeTitle("Edge TTS voices");
    typeTopic("Which voices read Polish well");
    await clickCreate();

    expect(fetchMock).toHaveBeenCalledWith("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Edge TTS voices",
        kind: "research",
        topic: "Which voices read Polish well",
      }),
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(refreshProjects).toHaveBeenCalled();
    expect(screen.getByTestId("location").textContent).toBe("/project/edge-tts-voices/iterm");
  });

  it("409 exists shows a link to the project", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ reason: "exists", name: "vector" }, 409));
    const { onClose } = renderDialog();
    typeTitle("Vector");
    await clickCreate();

    const link = await screen.findByTestId("new-project-exists-link");
    expect(link.getAttribute("href")).toBe("/project/vector");
    expect(screen.getByTestId("new-project-error").textContent).toMatch(/already exists/i);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("location").textContent).toBe("/");
  });

  it("409 archived offers Restore instead", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ reason: "archived", name: "old-thing" }, 409));
    const { onClose, restore } = renderDialog();
    typeTitle("Old thing");
    await clickCreate();

    expect(screen.getByTestId("new-project-error").textContent).toMatch(/archived/i);
    expect(screen.getByTestId("location").textContent).toBe("/");
    await act(async () => {
      fireEvent.click(await screen.findByTestId("new-project-restore"));
    });

    expect(restore).toHaveBeenCalledWith("old-thing");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(refreshProjects).toHaveBeenCalled();
    expect(screen.getByTestId("location").textContent).toBe("/project/old-thing/iterm");
  });

  it("failed Restore instead stays put with the error inline", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ reason: "archived", name: "old-thing" }, 409));
    const restore = vi.fn(async () => "target exists in projects/");
    const { onClose } = renderDialog({ restore });
    typeTitle("Old thing");
    await clickCreate();

    await act(async () => {
      fireEvent.click(await screen.findByTestId("new-project-restore"));
    });

    expect(restore).toHaveBeenCalledWith("old-thing");
    expect((await screen.findByTestId("new-project-error")).textContent).toBe(
      "target exists in projects/",
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(refreshProjects).not.toHaveBeenCalled();
    expect(screen.getByTestId("new-project-dialog")).toBeTruthy();
    expect(screen.getByTestId("location").textContent).toBe("/");
  });

  it("400 shows the error inline", async () => {
    fetchMock.mockReturnValueOnce(
      jsonResponse({ error: "a topic is required for research projects" }, 400),
    );
    const { onClose } = renderDialog();
    typeTitle("Something");
    await clickCreate();

    expect((await screen.findByTestId("new-project-error")).textContent).toBe(
      "a topic is required for research projects",
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("location").textContent).toBe("/");
  });
});
