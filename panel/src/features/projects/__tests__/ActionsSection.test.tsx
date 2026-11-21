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

  it("card shows glyph, label and Edit, no runner pill; + New action is last", () => {
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
    // No runner pill: the glyph alone tells shell from agent.
    expect(within(agent).queryByText("claude")).toBeNull();
    // The project is not printed on the card (it is in the run tooltip).
    expect(within(agent).queryByText("workspace")).toBeNull();
    expect(screen.getByTestId("action-run-0").title).toContain("workspace");
    const shell = screen.getByTestId("action-card-1");
    expect(within(shell).getByText("$_")).toBeTruthy();
    expect(within(shell).queryByText("sh")).toBeNull();
    expect(within(shell).queryByText("metro")).toBeNull();
    fireEvent.click(within(shell).getByRole("button", { name: "Edit Pull" }));
    expect(onEdit).toHaveBeenCalledWith(1);
    const grid = screen.getByTestId("actions-grid");
    const last = grid.lastElementChild as HTMLElement;
    expect(last.textContent).toContain("+ New action");
    fireEvent.click(last);
    expect(onNew).toHaveBeenCalled();
  });

  it("shows the whole label and an icon-only Edit revealed on hover", () => {
    mount();
    const label = screen.getByText("Knowledge harvest");
    expect(label.className).not.toContain("truncate");
    // A single long word must be able to shrink the 1fr track.
    expect(label.className).toContain("wrap-anywhere");
    const edit = screen.getByTestId("action-edit-0");
    expect(edit.textContent).toBe("");
    expect(edit.querySelector("svg")).toBeTruthy();
    expect(edit.className).toContain("opacity-0");
    expect(edit.className).toContain("group-hover:opacity-100");
    expect(edit.className).toContain("focus-visible:opacity-100");
    // Only devices that cannot hover at all see it without hover; a touch-capable
    // laptop with a mouse keeps it hidden until hover.
    expect(edit.className).toContain("[@media(hover:none)]:opacity-100");
    expect(edit.className).not.toContain("any-pointer:coarse");
    // A corner overlay: it takes no width from the label.
    expect(edit.className).toContain("absolute");
    expect(edit.className).toContain("top-1");
    expect(edit.className).toContain("right-1");
    expect(screen.getByTestId("action-card-0").className).toContain("relative");
    // Shorter card than the old py-2.5.
    expect(screen.getByTestId("action-run-0").className).toContain("py-2");
    expect(screen.getByTestId("action-run-0").className).not.toContain("py-2.5");
  });

  it("names the project only on cards whose label and runner repeat across projects", () => {
    writePreference(preferences.homeActions, [
      { label: "Pull", runner: "shell", text: "git pull", project: "workspace" },
      { label: "Pull", runner: "shell", text: "git pull", project: "metro" },
      { label: "Pull", runner: "claude", text: "x", project: "gitara" },
    ]);
    mount();
    expect(within(screen.getByTestId("action-card-0")).getByText("workspace")).toBeTruthy();
    expect(within(screen.getByTestId("action-card-1")).getByText("metro")).toBeTruthy();
    expect(within(screen.getByTestId("action-card-2")).queryByText("gitara")).toBeNull();
  });

  it("names the agent when same-label agent cards differ only by runner", () => {
    writePreference(preferences.homeActions, [
      { label: "Review", runner: "claude", text: "x", project: "workspace" },
      { label: "Review", runner: "codex", text: "x", project: "metro" },
      { label: "Lint", runner: "claude", text: "x", project: "metro" },
      { label: "Lint", runner: "codex", text: "x", project: "metro" },
    ]);
    mount();
    // Different project and runner: both are named.
    expect(within(screen.getByTestId("action-card-0")).getByText("workspace · claude")).toBeTruthy();
    expect(within(screen.getByTestId("action-card-1")).getByText("metro · codex")).toBeTruthy();
    // Same project: only the runner tells them apart.
    expect(within(screen.getByTestId("action-card-2")).getByText("claude")).toBeTruthy();
    expect(within(screen.getByTestId("action-card-3")).getByText("codex")).toBeTruthy();
    expect(screen.getByTestId("action-run-3").title).toContain("codex");
  });

  it("hidden Edit takes no clicks; phones reserve room for it", () => {
    mount();
    const edit = screen.getByTestId("action-edit-0");
    expect(edit.className).toContain("pointer-events-none");
    expect(edit.className).toContain("group-hover:pointer-events-auto");
    expect(edit.className).toContain("focus-visible:pointer-events-auto");
    expect(edit.className).toContain("[@media(hover:none)]:pointer-events-auto");
    // Where Edit is always shown, the label must not run under it.
    expect(screen.getByTestId("action-run-0").className).toContain("[@media(hover:none)]:pr-8");
  });

  it("shows Edit while touch is the active input, hides it again on mouse", () => {
    mount();
    const edit = () => screen.getByTestId("action-edit-0");
    expect(edit().className).toContain("opacity-0");
    act(() => {
      document.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true }));
    });
    expect(edit().className).not.toContain("opacity-0");
    expect(edit().className).not.toContain("pointer-events-none");
    // Layout is identical across input modes (no padding switch on mode change).
    const before = screen.getByTestId("action-run-0").className;
    act(() => {
      document.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "mouse", bubbles: true }));
    });
    expect(edit().className).toContain("opacity-0");
    expect(screen.getByTestId("action-run-0").className).toBe(before);
  });

  it("the look-alike hint wraps like the label", () => {
    writePreference(preferences.homeActions, [
      { label: "Review", runner: "claude", text: "x", project: "metro" },
      { label: "Review", runner: "codex", text: "x", project: "metro" },
    ]);
    mount();
    expect(within(screen.getByTestId("action-card-1")).getByText("codex").className).toContain("wrap-anywhere");
  });

  it("+ New action does not force the row taller than the compact cards", () => {
    mount();
    const last = screen.getByTestId("actions-grid").lastElementChild as HTMLElement;
    expect(last.style.minHeight).toBe("");
    expect(last.className).toContain("py-2");
    expect(last.className).not.toContain("py-2.5");
  });

  it("treats labels that render alike (collapsed whitespace) as the same look", () => {
    writePreference(preferences.homeActions, [
      { label: "Sync docs", runner: "shell", text: "x", project: "workspace" },
      { label: "Sync  docs", runner: "shell", text: "y", project: "metro" },
    ]);
    mount();
    expect(within(screen.getByTestId("action-card-0")).getByText("workspace")).toBeTruthy();
    expect(within(screen.getByTestId("action-card-1")).getByText("metro")).toBeTruthy();
  });

  it("treats a non-breaking space like an ordinary one", () => {
    writePreference(preferences.homeActions, [
      { label: "Sync docs", runner: "shell", text: "x", project: "workspace" },
      { label: "Sync\u00a0docs", runner: "shell", text: "y", project: "metro" },
    ]);
    mount();
    expect(within(screen.getByTestId("action-card-0")).getByText("workspace")).toBeTruthy();
    expect(within(screen.getByTestId("action-card-1")).getByText("metro")).toBeTruthy();
  });

  it("keeps full-width spaces distinct (the browser does not collapse them)", () => {
    writePreference(preferences.homeActions, [
      { label: "Sync docs", runner: "shell", text: "x", project: "workspace" },
      { label: "Sync\u3000\u3000docs", runner: "shell", text: "y", project: "metro" },
    ]);
    mount();
    expect(within(screen.getByTestId("action-card-0")).queryByText("workspace")).toBeNull();
    expect(within(screen.getByTestId("action-card-1")).queryByText("metro")).toBeNull();
  });

  it("the run button highlights on hover unless blocked", () => {
    mount();
    expect(screen.getByTestId("action-run-0").className).toMatch(/hover:bg-/);
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
    // Both defaults are agent actions: the ▶ glyph, no runner pill.
    expect(screen.getAllByText("▶")).toHaveLength(2);
    expect(screen.queryByText("claude")).toBeNull();
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
    expect(screen.getByTestId("action-run-0").className).not.toMatch(/hover:bg-/);
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
