import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { SessionMeta } from "../../terminal/useTerminalSessions";

vi.mock("../../terminal/createTerminalSession", () => ({
  createTerminalSession: vi.fn(),
}));

const store = vi.hoisted(() => ({ sessions: [] as SessionMeta[] }));
vi.mock("../../terminal/sessionStore", () => ({
  getSessions: () => store.sessions,
  refreshSessions: vi.fn(async () => {}),
}));

const drawer = vi.hoisted(() => ({ visible: false }));
vi.mock("../../terminal/useTerminalDrawer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../terminal/useTerminalDrawer")>()),
  useTerminalDrawerVisible: () => drawer.visible,
}));

vi.mock("../../terminal/useTerminalSessions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../terminal/useTerminalSessions")>()),
  dispatchTerminalFocus: vi.fn(),
}));

import { CodeTerminalButton } from "../CodeTerminalButton";
import { createTerminalSession } from "../../terminal/createTerminalSession";
import { dispatchTerminalFocus, nextProjectName } from "../../terminal/useTerminalSessions";

const ROOT = "/x/pavilio-wt";

function session(id: string, project: string, name: string): SessionMeta {
  return { id, project, name } as SessionMeta;
}

function Probe() {
  return <span data-testid="path">{useLocation().pathname}</span>;
}

function renderButton() {
  return render(
    <MemoryRouter initialEntries={["/project/pavilio/repos"]}>
      <CodeTerminalButton project="pavilio" root={ROOT} repoName="pavilio" />
      <Probe />
    </MemoryRouter>,
  );
}

const button = () => screen.getByTestId("code-terminal");
const path = () => screen.getByTestId("path").textContent;

async function click() {
  await act(async () => {
    fireEvent.click(button());
  });
}

describe("CodeTerminalButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    drawer.visible = false;
    store.sessions = [
      session("a", "pavilio", "pavilio-1"),
      session("b", "other", "pavilio-2"),
    ];
    vi.mocked(createTerminalSession).mockResolvedValue(session("new-1", "pavilio", "pavilio-2"));
  });

  it("terminal button creates a session at the open checkout root", async () => {
    renderButton();
    await click();
    const projectSessions = store.sessions.filter((s) => s.project === "pavilio");
    expect(createTerminalSession).toHaveBeenCalledWith("pavilio", projectSessions, {
      cwd: ROOT,
      name: nextProjectName("pavilio", projectSessions),
    });
    expect(vi.mocked(createTerminalSession).mock.calls[0][2]?.name).toBe("pavilio-2");
  });

  it("terminal button navigates to Terminals when the drawer is hidden", async () => {
    renderButton();
    await click();
    expect(dispatchTerminalFocus).toHaveBeenCalledWith("pavilio", "new-1");
    expect(path()).toBe("/project/pavilio/iterm");
  });

  it("terminal button only focuses when the drawer is visible", async () => {
    drawer.visible = true;
    renderButton();
    await click();
    expect(dispatchTerminalFocus).toHaveBeenCalledWith("pavilio", "new-1");
    expect(path()).toBe("/project/pavilio/repos");
  });

  it("terminal button shows Opening while busy", async () => {
    let resolve: (value: SessionMeta | null) => void = () => {};
    vi.mocked(createTerminalSession).mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    renderButton();
    await click();
    expect(button()).toBeDisabled();
    expect(button()).toHaveTextContent("Opening…");
    await act(async () => {
      resolve(session("new-1", "pavilio", "pavilio-2"));
    });
    expect(button()).not.toBeDisabled();
    expect(button()).toHaveTextContent("Terminal");
  });

  it("terminal button failure shows an alert and re-enables", async () => {
    vi.mocked(createTerminalSession).mockResolvedValueOnce(null);
    renderButton();
    await click();
    expect(screen.getByRole("alert")).toHaveTextContent(`Couldn't open a terminal at ${ROOT}`);
    expect(button()).not.toBeDisabled();
    expect(dispatchTerminalFocus).not.toHaveBeenCalled();
    expect(path()).toBe("/project/pavilio/repos");
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("terminal button renders icon, label and title", () => {
    renderButton();
    expect(button()).toHaveAttribute("title", `Open a terminal at ${ROOT}`);
    expect(button()).toHaveTextContent("Terminal");
    expect(button().querySelector("svg")).not.toBeNull();
  });
});
