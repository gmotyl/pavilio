import { describe, it, expect } from "vitest";
import { taskListStatus } from "../taskList";

const TASKS = "plans/openspec/changes/2026-09-28-commands-in-context/tasks.md";

function list(checked: number, unchecked: number): string {
  return [
    "# Tasks",
    "",
    ...Array.from({ length: checked }, (_, i) => `- [x] done ${i}`),
    ...Array.from({ length: unchecked }, (_, i) => `- [ ] todo ${i}`),
  ].join("\n");
}

describe("taskListStatus", () => {
  it("counts total and remaining for an active change", () => {
    expect(taskListStatus(TASKS, list(5, 12))).toEqual({
      changeId: "2026-09-28-commands-in-context",
      total: 17,
      remaining: 12,
    });
  });

  it("a fully checked list returns a done status", () => {
    expect(taskListStatus(TASKS, list(6, 0))).toEqual({
      changeId: "2026-09-28-commands-in-context",
      total: 6,
      remaining: 0,
    });
  });

  it("a file with no checkboxes is still not a task list", () => {
    expect(taskListStatus(TASKS, "# Tasks\n\n- a plain item\n")).toBeNull();
    expect(taskListStatus(TASKS, "")).toBeNull();
  });

  it("an archived change is not runnable", () => {
    expect(
      taskListStatus("plans/openspec/changes/archive/2026-04-01-old/tasks.md", list(1, 3)),
    ).toBeNull();
  });

  it("a stray tasks.md directly under changes/archive is not runnable", () => {
    // Without the archive guard this path would parse as a change named "archive".
    expect(taskListStatus("plans/openspec/changes/archive/tasks.md", list(1, 3))).toBeNull();
  });

  it("a proposal with checkboxes is not a task list", () => {
    expect(
      taskListStatus("plans/openspec/changes/2026-09-28-commands-in-context/proposal.md", list(0, 3)),
    ).toBeNull();
  });

  it("a legacy flat plan is not a change", () => {
    expect(taskListStatus("plans/tasks.md", list(0, 3))).toBeNull();
    expect(taskListStatus("plans/2026-01-01-feature/tasks.md", list(0, 3))).toBeNull();
  });

  it("an indented checkbox is counted", () => {
    const content = ["- Task 1", "  - [x] step one", "    - [ ] step two", "\t- [ ] step three"].join("\n");
    expect(taskListStatus(TASKS, content)).toEqual({
      changeId: "2026-09-28-commands-in-context",
      total: 3,
      remaining: 2,
    });
  });

  it("treats [X] as checked and accepts * and + bullets", () => {
    const content = ["* [X] upper", "+ [x] plus", "* [ ] star todo"].join("\n");
    expect(taskListStatus(TASKS, content)).toEqual({
      changeId: "2026-09-28-commands-in-context",
      total: 3,
      remaining: 1,
    });
  });

  it("ignores checkboxes inside fenced code blocks", () => {
    const content = ["- [x] real", "```md", "- [ ] example", "```", "~~~", "- [ ] tilde", "~~~"].join(
      "\n",
    );
    // Only the real box counts: one, checked — the fenced ones are not work left.
    expect(taskListStatus(TASKS, content)).toMatchObject({ total: 1, remaining: 0 });
    // Boxes only inside fences: no checkbox at all, so no task list.
    expect(taskListStatus(TASKS, ["```md", "- [ ] example", "```"].join("\n"))).toBeNull();
  });

  it("does not count bracket text that is not a list checkbox", () => {
    const content = ["See [ ] in prose", "- [ ]no space after box", "- [ ] real"].join("\n");
    expect(taskListStatus(TASKS, content)?.total).toBe(1);
  });

  it("only qualifies a tasks.md sitting directly in the change dir", () => {
    expect(
      taskListStatus("plans/openspec/changes/abc/specs/panel/tasks.md", list(0, 2)),
    ).toBeNull();
    expect(taskListStatus("changes/abc/tasks.md", list(0, 2))?.changeId).toBe("abc");
  });
});
