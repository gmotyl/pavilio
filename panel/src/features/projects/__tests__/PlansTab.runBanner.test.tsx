import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";

import { renderWithRouter } from "../../../test-utils";
import { preferences, type TerminalLauncher } from "../../../preferences/declarations";
import { __resetPreferenceStoreForTests, writePreference } from "../../../preferences/store";

vi.mock("../../realtime/useWebSocket", () => ({
  useWebSocket: () => ({ lastMessage: null }),
}));

vi.mock("../startTaskRun", () => ({
  startTaskRun: vi.fn(async () => "new-1"),
}));

import PlansTab from "../PlansTab";
import { startTaskRun } from "../startTaskRun";
import { __resetWorkspaceRootForTests } from "../useWorkspaceRoot";

type PrefGlobals = { __PAVILIO_PREFS__?: Record<string, unknown> };
const globals = globalThis as unknown as PrefGlobals;

const LAUNCHERS: TerminalLauncher[] = [
  { name: "claude", command: "claude", runLoop: 'claude "/goal {prompt}"' },
];

const ACTIVE_TASKS = "/p/projects/alokai/plans/openspec/changes/live-change/tasks.md";
const ACTIVE_PROPOSAL = "/p/projects/alokai/plans/openspec/changes/live-change/proposal.md";
const OTHER_TASKS = "/p/projects/alokai/plans/openspec/changes/next-change/tasks.md";
const ARCHIVED_TASKS =
  "/p/projects/alokai/plans/openspec/changes/archive/2026-01-05-done-change/tasks.md";

const artifact = (kind: string, absolutePath: string) => {
  const filename = absolutePath.slice(absolutePath.lastIndexOf("/") + 1);
  return {
    kind,
    capability: null,
    filename,
    modified: 5,
    absolutePath,
    relativeToProjectsDir: absolutePath.slice("/p/projects/".length),
  };
};

const TREE = {
  project: "alokai",
  sources: [
    {
      id: "openspec:project",
      label: "alokai (OpenSpec)",
      kind: "openspec",
      mode: "store",
      openspecDir: "/p/projects/alokai/plans/openspec",
      changes: [
        {
          changeId: "live-change",
          source: "openspec:project",
          status: "active",
          archiveDate: null,
          artifacts: [artifact("proposal", ACTIVE_PROPOSAL), artifact("tasks", ACTIVE_TASKS)],
        },
        {
          changeId: "next-change",
          source: "openspec:project",
          status: "active",
          archiveDate: null,
          artifacts: [artifact("tasks", OTHER_TASKS)],
        },
        {
          changeId: "2026-01-05-done-change",
          source: "openspec:project",
          status: "archived",
          archiveDate: "2026-01-05",
          artifacts: [artifact("tasks", ARCHIVED_TASKS)],
        },
      ],
    },
  ],
};

// Every file carries unchecked boxes, so only the PATH decides the banner.
const CONTENT = "# Tasks\n\n- [x] Step one done\n- [ ] Step two pending\n";

// The parent of the projects directory, as `/api/system` reports it. The run
// line names the plan relative to it.
const WORKSPACE_ROOT = "/p";
const ACTIVE_TASKS_RELATIVE = "projects/alokai/plans/openspec/changes/live-change/tasks.md";

let fetchMock: ReturnType<typeof vi.fn>;
/** When set, `/api/system` never answers: the workspace root is still loading. */
let systemPending: boolean;

beforeEach(() => {
  globals.__PAVILIO_PREFS__ = { version: 1 };
  writePreference(preferences.terminalLaunchers, LAUNCHERS);
  vi.mocked(startTaskRun).mockClear();
  __resetWorkspaceRootForTests();
  systemPending = false;
  fetchMock = vi.fn(async (input: string) => {
    const url = String(input);
    if (url.startsWith("/api/system")) {
      if (systemPending) return new Promise<Response>(() => {});
      return new Response(JSON.stringify({ wslDistro: null, workspaceRoot: WORKSPACE_ROOT }), {
        status: 200,
      });
    }
    if (url.includes("plans-tree")) return new Response(JSON.stringify(TREE), { status: 200 });
    if (url.includes("plans/read")) {
      return new Response(JSON.stringify({ content: CONTENT }), { status: 200 });
    }
    return new Response('{"ok":true}', { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  delete globals.__PAVILIO_PREFS__;
  __resetPreferenceStoreForTests();
  vi.unstubAllGlobals();
});

function open(path: string) {
  return renderWithRouter(
    <Routes>
      <Route path="/" element={<PlansTab projectName="alokai" />} />
      <Route path="/project/:name/iterm" element={<p>terminal view</p>} />
    </Routes>,
    { initialEntries: [`/?file=${encodeURIComponent(path)}`] },
  );
}

describe("PlansTab run banner", () => {
  it("the banner is shown for an active change's tasks.md", async () => {
    open(ACTIVE_TASKS);
    const checklistItem = await screen.findByText("Step two pending");
    const banner = screen.getByRole("region", { name: "Run this change" });
    // Above the checklist: the banner precedes the rendered markdown.
    expect(
      banner.compareDocumentPosition(checklistItem) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("no banner is shown for a proposal or an archived change", async () => {
    const first = open(ACTIVE_PROPOSAL);
    await screen.findByText("Step two pending");
    expect(screen.queryByRole("region", { name: "Run this change" })).toBeNull();
    first.unmount();

    open(ARCHIVED_TASKS);
    await screen.findByText("Step two pending");
    expect(screen.queryByRole("region", { name: "Run this change" })).toBeNull();
  });

  it("Run starts a task run for the project and opens its terminal", async () => {
    open(ACTIVE_TASKS);
    await screen.findByText("Step two pending");
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(vi.mocked(startTaskRun)).toHaveBeenCalledTimes(1));
    const [opts] = vi.mocked(startTaskRun).mock.calls[0];
    expect(opts.project).toBe("alokai");
    expect(opts.runLine.startsWith("claude '/goal ")).toBe(true);
    expect(await screen.findByText("terminal view")).toBeTruthy();
  });

  it("the run line names the plan by its workspace-relative path", async () => {
    open(ACTIVE_TASKS);
    await screen.findByText("Step two pending");
    const run = screen.getByRole("button", { name: "Run" });
    await waitFor(() => expect(run).not.toBeDisabled());
    fireEvent.click(run);
    await waitFor(() => expect(vi.mocked(startTaskRun)).toHaveBeenCalledTimes(1));
    const { runLine } = vi.mocked(startTaskRun).mock.calls[0][0];
    // The default objective's `{path}`, resolved against the stubbed root.
    expect(runLine).toContain(`Implement all tasks in ${ACTIVE_TASKS_RELATIVE};`);
    expect(runLine).not.toContain(ACTIVE_TASKS);
  });

  it("Run waits for the workspace root rather than send an absolute path", async () => {
    systemPending = true;
    open(ACTIVE_TASKS);
    await screen.findByText("Step two pending");
    const run = screen.getByRole("button", { name: "Run" });
    expect(run).toBeDisabled();
    fireEvent.click(run);
    // Neither shown nor sent: the owner's tree never stands in for the path.
    const objective = screen.getByRole("textbox", { name: "Objective" }) as HTMLTextAreaElement;
    expect(objective.value).toContain("Implement all tasks in");
    expect(objective.value).not.toContain(ACTIVE_TASKS);
    expect(vi.mocked(startTaskRun)).not.toHaveBeenCalled();
  });

  it("a flagged launcher's line reaches the new session", async () => {
    writePreference(preferences.terminalLaunchers, [
      { name: "opencode", command: "opencode", runLoop: "{prompt}", promptFlag: "--prompt" },
    ]);
    open(ACTIVE_TASKS);
    await screen.findByText("Step two pending");
    const objective = screen.getByRole("textbox", { name: "Objective" }) as HTMLTextAreaElement;
    expect(objective.value).not.toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(vi.mocked(startTaskRun)).toHaveBeenCalledTimes(1));
    // startTaskRun types this line and its Enter into the session it creates.
    expect(vi.mocked(startTaskRun).mock.calls[0][0]).toEqual({
      project: "alokai",
      runLine: `opencode --prompt '${objective.value}'`,
    });
  });

  it("a whole-line launcher never creates a session", async () => {
    writePreference(preferences.terminalLaunchers, [
      { name: "mine", command: "claude", runLoop: 'claude "/goal {prompt}"' },
    ]);
    open(ACTIVE_TASKS);
    await screen.findByText("Step two pending");
    expect(screen.getByTestId("run-banner-blocked")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    const objective = screen.getByRole("textbox", { name: "Objective" });
    fireEvent.keyDown(objective, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(objective, { key: "Enter", metaKey: true });
    await new Promise((r) => setTimeout(r, 20));

    expect(vi.mocked(startTaskRun)).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/api/terminal"))).toBe(false);
    expect(screen.queryByText("terminal view")).toBeNull();
  });

  it("a failed run is reported in the banner's place", async () => {
    vi.mocked(startTaskRun).mockRejectedValueOnce(new Error("Could not create a terminal"));
    open(ACTIVE_TASKS);
    await screen.findByText("Step two pending");
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not create a terminal");
    expect(screen.queryByText("terminal view")).toBeNull();
  });

  it("a run that fails after switching to another tasks.md shows no error there", async () => {
    let rejectRun: (err: Error) => void = () => {};
    vi.mocked(startTaskRun).mockImplementationOnce(
      () => new Promise<string>((_resolve, reject) => (rejectRun = reject)),
    );
    open(ACTIVE_TASKS);
    await screen.findByText("Step two pending");
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(vi.mocked(startTaskRun)).toHaveBeenCalledTimes(1));

    // The user moves on to the other change's tasks.md before the run settles.
    fireEvent.click(
      await screen.findByTestId("plans-tab-artifact-openspec:project-next-change-tasks"),
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u]) => String(u).includes("plans/read") && String(u).includes("next-change"),
        ),
      ).toBe(true),
    );
    await screen.findByText("Step two pending");

    rejectRun(new Error("Could not create a terminal"));
    // Let the rejection land, then check nothing was reported under the new file.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
