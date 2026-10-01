import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";

import { renderWithRouter } from "../../../test-utils";
import type { TerminalLauncher } from "../../../preferences/declarations";
import { __resetPreferenceStoreForTests } from "../../../preferences/store";
import type { RunBannerProps } from "../RunBanner";

/**
 * PlansTab's own refusal, below the banner: its `onRun` is called directly
 * with launchers the banner would never pass, so the guard is what is tested
 * and not the banner's disabled Run.
 */

vi.mock("../../realtime/useWebSocket", () => ({
  useWebSocket: () => ({ lastMessage: null }),
}));

vi.mock("../startTaskRun", () => ({
  startTaskRun: vi.fn(async () => "new-1"),
}));

// The banner is replaced by a stub that hands its props to the test.
const bannerProps: { current: RunBannerProps | null } = { current: null };
vi.mock("../RunBanner", () => ({
  RunBanner: (props: RunBannerProps) => {
    bannerProps.current = props;
    return <p>run banner stub</p>;
  },
}));

import PlansTab from "../PlansTab";
import { startTaskRun } from "../startTaskRun";

type PrefGlobals = { __PAVILIO_PREFS__?: Record<string, unknown> };
const globals = globalThis as unknown as PrefGlobals;

const TASKS = "/p/projects/alokai/plans/openspec/changes/live-change/tasks.md";

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
          artifacts: [
            {
              kind: "tasks",
              capability: null,
              filename: "tasks.md",
              modified: 5,
              absolutePath: TASKS,
              relativeToProjectsDir: TASKS.slice("/p/projects/".length),
            },
          ],
        },
      ],
    },
  ],
};

const CONTENT = "# Tasks\n\n- [x] Step one done\n- [ ] Step two pending\n";

beforeEach(() => {
  globals.__PAVILIO_PREFS__ = { version: 1 };
  bannerProps.current = null;
  vi.mocked(startTaskRun).mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("plans-tree")) return new Response(JSON.stringify(TREE), { status: 200 });
      if (url.includes("plans/read")) {
        return new Response(JSON.stringify({ content: CONTENT }), { status: 200 });
      }
      return new Response('{"ok":true}', { status: 200 });
    }),
  );
});

afterEach(() => {
  delete globals.__PAVILIO_PREFS__;
  __resetPreferenceStoreForTests();
  vi.unstubAllGlobals();
});

async function openBanner(): Promise<RunBannerProps> {
  renderWithRouter(
    <Routes>
      <Route path="/" element={<PlansTab projectName="alokai" />} />
      <Route path="/project/:name/iterm" element={<p>terminal view</p>} />
    </Routes>,
    { initialEntries: [`/?file=${encodeURIComponent(TASKS)}`] },
  );
  await screen.findByText("run banner stub");
  if (!bannerProps.current) throw new Error("the banner was not rendered");
  return bannerProps.current;
}

describe("PlansTab run refusal", () => {
  it("a launcher whose run loop is not ready is refused", async () => {
    const { onRun } = await openBanner();
    const wholeLine: TerminalLauncher = {
      name: "mine",
      command: "claude",
      runLoop: 'claude "/goal {prompt}"',
    };
    const none: TerminalLauncher = { name: "mine", command: "tool" };

    let results: unknown[] = [];
    await act(async () => {
      results = [
        onRun({ launcher: wholeLine, objective: "go" }),
        onRun({ launcher: none, objective: "go" }),
      ];
    });

    expect(results).toEqual([undefined, undefined]);
    expect(vi.mocked(startTaskRun)).not.toHaveBeenCalled();
  });

  it("a ready launcher starts the composed line", async () => {
    const { onRun } = await openBanner();
    await act(async () => {
      await onRun({
        launcher: { name: "mine", command: "tool", runLoop: "/goal {prompt}", promptFlag: "" },
        objective: "go",
      });
    });

    expect(vi.mocked(startTaskRun)).toHaveBeenCalledWith({
      project: "alokai",
      runLine: "tool '/goal go'",
    });
  });
});
