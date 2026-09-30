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

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  globals.__PAVILIO_PREFS__ = { version: 1 };
  writePreference(preferences.terminalLaunchers, LAUNCHERS);
  vi.mocked(startTaskRun).mockClear();
  fetchMock = vi.fn(async (input: string) => {
    const url = String(input);
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
