import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const proj = (name: string, group: string | null = null) => ({
  name,
  path: `/tmp/${name}`,
  hasIndex: false,
  hasNotes: false,
  hasProgress: false,
  hasPlans: false,
  hasWiki: false,
  latestProgressDate: "2026-11-18",
  kind: "project",
  lastActivity: null,
  repos: [],
  group,
});
const ALL = [proj("workspace", "Workspace"), proj("metro", "Clients"), proj("gitara")];
let PROJECTS: typeof ALL = ALL;

vi.mock("../useProjects", () => ({ useProjects: () => PROJECTS }));
vi.mock("../../mobile-access/MobileAccessButton", () => ({ MobileAccessButton: () => null }));

const launches = vi.hoisted(() => ({
  fn: vi.fn(async (_line: string) => {}),
  projects: [] as string[],
}));
vi.mock("../useLaunchRun", () => ({
  useLaunchRun: (project: string) => {
    launches.projects.push(project);
    return (line: string) => launches.fn(line);
  },
}));
vi.mock("../../alerts/store", () => ({
  alerts: { error: vi.fn(), success: vi.fn() },
}));

import Dashboard from "../Dashboard";
import { ActionsSection } from "../ActionsSection";
import { alerts } from "../../alerts/store";
import { preferences } from "../../../preferences/declarations";
import { __resetPreferenceStoreForTests, readPreference, writePreference } from "../../../preferences/store";

function mount() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
}

describe("ActionsSection", () => {
  beforeEach(() => {
    PROJECTS = ALL;
    __resetPreferenceStoreForTests();
    launches.fn.mockClear();
    launches.fn.mockImplementation(async () => {});
    launches.projects.length = 0;
    vi.mocked(alerts.error).mockClear();
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    __resetPreferenceStoreForTests();
  });

  it("Actions section renders above the Projects heading", () => {
    mount();
    const head = screen.getByTestId("actions-section-head");
    expect(head.textContent).toContain("Actions");
    expect(head.textContent).toContain("2");
    const h1 = screen.getByRole("heading", { level: 1, name: "Projects" });
    expect(head.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("card shows glyph, label, runner pill, project and Edit; + New action is last", () => {
    writePreference(preferences.homeActions, [
      { label: "Harvest", runner: "claude", text: "x", project: "workspace" },
      { label: "Pull", runner: "shell", text: "git pull", project: "metro" },
    ]);
    const onEdit = vi.fn();
    const onNew = vi.fn();
    render(
      <MemoryRouter>
        <ActionsSection onEdit={onEdit} onNew={onNew} />
      </MemoryRouter>,
    );
    const agent = screen.getByTestId("action-card-0");
    expect(within(agent).getByText("▶")).toBeTruthy();
    expect(within(agent).getByText("Harvest")).toBeTruthy();
    expect(within(agent).getByText("claude")).toBeTruthy();
    expect(within(agent).getByText("workspace")).toBeTruthy();
    const shell = screen.getByTestId("action-card-1");
    expect(within(shell).getByText("$_")).toBeTruthy();
    expect(within(shell).getByText("sh")).toBeTruthy();
    expect(within(shell).getByText("metro")).toBeTruthy();
    fireEvent.click(within(shell).getByRole("button", { name: "Edit Pull" }));
    expect(onEdit).toHaveBeenCalledWith(1);
    const grid = screen.getByTestId("actions-grid");
    const last = grid.lastElementChild as HTMLElement;
    expect(last.textContent).toContain("+ New action");
    fireEvent.click(last);
    expect(onNew).toHaveBeenCalled();
  });

  it("Edit and + New action have hover and focus styles", () => {
    mount();
    for (const el of [screen.getByTestId("action-edit-0"), screen.getByTestId("actions-new")]) {
      expect(el.className).toMatch(/hover:bg-/);
      expect(el.className).toContain("focus-visible:");
    }
  });

  it("Edit and + New action open the action modal", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Edit Knowledge harvest" }));
    expect(screen.getByRole("heading", { name: "Edit action" })).toBeTruthy();
    expect((screen.getByLabelText("Label") as HTMLInputElement).value).toBe("Knowledge harvest");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByText("+ New action"));
    expect(screen.getByRole("heading", { name: "New action" })).toBeTruthy();
  });

  it("defaults render when nothing is stored", () => {
    mount();
    for (const label of ["Process meetings", "Knowledge harvest"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getAllByText("claude")).toHaveLength(2);
    expect(screen.getAllByText("workspace").length).toBeGreaterThanOrEqual(2);
  });

  it("clicking a card runs its line in its project", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Run Process meetings" }));
    await waitFor(() => expect(launches.fn).toHaveBeenCalledTimes(1));
    const line = launches.fn.mock.calls[0][0];
    expect(line).toContain("pavilio-note-batch");
    expect(line.startsWith("claude")).toBe(true);
    expect(launches.projects).toContain("workspace");
  });

  it("failed launch raises an error alert", async () => {
    launches.fn.mockRejectedValueOnce(new Error("no pty"));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Run Knowledge harvest" }));
    await waitFor(() => expect(alerts.error).toHaveBeenCalled());
    const [title, opts] = vi.mocked(alerts.error).mock.calls[0] as [string, { detail?: string }];
    expect(title).toContain("Knowledge harvest");
    expect(opts.detail).toContain("no pty");
  });

  it("blocked card shows its reason and does not run", () => {
    writePreference(preferences.homeActions, [
      { label: "Ghost", runner: "claude", text: "x", project: "nope" },
    ]);
    mount();
    const card = screen.getByTestId("action-card-0");
    expect(within(card).getByText("project missing")).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Run Ghost" }));
    expect(launches.fn).not.toHaveBeenCalled();
    expect((within(card).getByRole("button", { name: "Edit Ghost" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("chips never filter actions", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /^Clients/ }));
    expect(screen.getByText("Process meetings")).toBeTruthy();
    expect(screen.getByText("Knowledge harvest")).toBeTruthy();
    expect(screen.getByTestId("action-card-1")).toBeTruthy();
  });

  it("cards stack in one column at 390px (auto-fill grid, min 210px)", () => {
    mount();
    const style = screen.getByTestId("actions-grid").getAttribute("style") ?? "";
    expect(style).toContain("repeat(auto-fill");
    expect(style).toContain("minmax(210px");
  });

  it("while projects load, no project-missing blocker and a click still runs", async () => {
    PROJECTS = [];
    render(
      <MemoryRouter>
        <ActionsSection />
      </MemoryRouter>,
    );
    expect(screen.getByText("Process meetings")).toBeTruthy();
    expect(screen.queryByText("project missing")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Run Process meetings" }));
    await waitFor(() => expect(launches.fn).toHaveBeenCalledTimes(1));
  });

  describe("project filter", () => {
    const LIST = [
      { label: "Harvest", runner: "claude", text: "x", project: "workspace" },
      { label: "Pull", runner: "shell", text: "git pull", project: "metro" },
      { label: "Notes", runner: "claude", text: "y", project: "workspace" },
    ];
    const mountFor = (project: string) => {
      writePreference(preferences.homeActions, LIST);
      return render(
        <MemoryRouter>
          <ActionsSection project={project} />
        </MemoryRouter>,
      );
    };

    it("shows only the cards of that project, keeping their real index in the test ids", () => {
      mountFor("workspace");
      expect(screen.getByText("Harvest")).toBeTruthy();
      expect(screen.getByText("Notes")).toBeTruthy();
      expect(screen.queryByText("Pull")).toBeNull();
      expect(screen.getByTestId("action-card-2")).toBeTruthy();
      expect(screen.queryByTestId("action-card-1")).toBeNull();
      expect(screen.getByTestId("actions-section-head").textContent).toContain("2");
    });

    it("renders nothing when the project has no actions", () => {
      mountFor("gitara");
      expect(screen.queryByTestId("actions-section")).toBeNull();
    });

    it("Edit and Delete act on the real entry of the full list", () => {
      mountFor("workspace");
      fireEvent.click(screen.getByRole("button", { name: "Edit Notes" }));
      expect((screen.getByLabelText("Label") as HTMLInputElement).value).toBe("Notes");
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
      expect(readPreference(preferences.homeActions).map((a) => a.label)).toEqual(["Harvest", "Pull"]);
    });

    it("+ New action defaults the project to this one", () => {
      mountFor("metro");
      fireEvent.click(screen.getByText("+ New action"));
      expect((screen.getByLabelText("Project") as HTMLSelectElement).value).toBe("metro");
    });

    it("the dashed New card's border is a class, not an inline style that shadows its hover", () => {
      mountFor("workspace");
      const btn = screen.getByTestId("actions-new");
      expect(btn.style.borderColor).toBe("");
      expect(btn.className).toContain("border-[var(--border-subtle)]");
      expect(btn.className).toContain("hover:border-[var(--border-strong)]");
    });

    it("closes the modal when the project prop changes", () => {
      writePreference(preferences.homeActions, LIST);
      const ui = (project: string) => (
        <MemoryRouter>
          <ActionsSection project={project} />
        </MemoryRouter>
      );
      const view = render(ui("workspace"));
      fireEvent.click(screen.getByText("+ New action"));
      expect(screen.getByRole("dialog")).toBeTruthy();
      view.rerender(ui("metro"));
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("keeps an open New modal (and its draft) when the last action disappears", () => {
      mountFor("workspace");
      fireEvent.click(screen.getByText("+ New action"));
      fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Draft" } });
      act(() => {
        writePreference(preferences.homeActions, []);
      });
      expect(screen.getByRole("dialog")).toBeTruthy();
      expect((screen.getByLabelText("Label") as HTMLInputElement).value).toBe("Draft");
    });

    it("has no drag grip", () => {
      mountFor("workspace");
      expect(screen.queryByTestId("action-grip")).toBeNull();
    });
  });
});
