// Workspace Actions are the server's list, rendered verbatim.
//
// The component used to carry its own WORKSPACE_ACTIONS constant, so Settings
// offered buttons for scripts a fresh clone does not have. The catalogue now
// lives on the server, which intersects it with the workspace's own
// package.json; the page's only job is to render whatever comes back. This
// suite therefore answers `/api/agent-settings/actions` with a list that does
// NOT match the old constant — different ids, different labels, different
// descriptions — so a component that still knows any of them fails.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AgentSettings from "../AgentSettings";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** What the server says this workspace can run — deliberately not the old list. */
const SERVED_ACTIONS = [
  {
    // id and script differ on purpose: the id is the wire contract, the script
    // is what package.json defines (`setup` is a pnpm built-in, hence
    // `bootstrap`).
    id: "setup",
    script: "bootstrap",
    label: "Setup workspace",
    description: "Installs dependencies and prepares this clone to run the panel.",
  },
  {
    id: "init:codex",
    script: "setup:codex",
    label: "Init Codex",
    description: "Installs this workspace's skills as Codex prompts.",
  },
];

/**
 * Routes the GETs the page makes plus the run-action POST; anything else is a
 * test bug. `actionsFails` answers the actions endpoint with a rejection, which
 * is the only way to tell a broken server from a workspace with no actions.
 */
function stubApi(
  actions: unknown = SERVED_ACTIONS,
  opts: { actionsFails?: boolean } = {},
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/agent-settings/run-action")) {
      expect(init?.method).toBe("POST");
      return { ok: true, json: async () => ({ ok: true, output: "ran" }) } as unknown as Response;
    }
    if (url.startsWith("/api/agent-settings/actions")) {
      if (opts.actionsFails) throw new Error("connection refused");
      return { ok: true, json: async () => actions } as unknown as Response;
    }
    if (url.startsWith("/api/agent-settings")) {
      return { ok: true, json: async () => [] } as unknown as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The JSON body of the single run-action POST the page made. */
function postedRunAction(fetchMock: ReturnType<typeof stubApi>): unknown {
  const posts = fetchMock.mock.calls.filter(([url]) =>
    String(url).startsWith("/api/agent-settings/run-action"),
  );
  expect(posts).toHaveLength(1);
  return JSON.parse(String((posts[0][1] as RequestInit).body));
}

/** Every action button on the page, in DOM order, by its id. */
function renderedActionIds(): string[] {
  return screen
    .getAllByTestId(/^agent-settings-action-/)
    .map((el) => el.getAttribute("data-testid")!.replace("agent-settings-action-", ""));
}

describe("AgentSettings workspace actions", () => {
  it("AgentSettings renders the server's action list and nothing hard-coded", async () => {
    stubApi();
    render(<AgentSettings />);

    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    await screen.findByTestId("agent-settings-action-setup");

    // Exactly the served ids, in the server's order.
    expect(renderedActionIds()).toEqual(["setup", "init:codex"]);

    // The server's labels, not the component's.
    expect(screen.getByTestId("agent-settings-action-setup")).toHaveTextContent("Setup workspace");
    expect(screen.getByTestId("agent-settings-action-init:codex")).toHaveTextContent("Init Codex");

    // Nothing the old hard-coded constant used to offer survives.
    expect(screen.queryByTestId("agent-settings-action-init:claude")).toBeNull();
    expect(screen.queryByTestId("agent-settings-action-init:opencode")).toBeNull();
    expect(screen.queryByTestId("agent-settings-action-setup:backup")).toBeNull();
    expect(screen.queryByTestId("agent-settings-action-setup:restore")).toBeNull();

    // And the description shown before running is the server's too.
    await userEvent.click(screen.getByTestId("agent-settings-action-init:codex"));
    expect(
      await screen.findByText("Installs this workspace's skills as Codex prompts."),
    ).toBeInTheDocument();
  });

  it("posts the action id, never the script name", async () => {
    // The id and the script drifted apart on purpose, and only the id is the
    // wire contract: posting `setup:codex` here would 400 on the server, which
    // is the exact failure this design makes possible.
    const fetchMock = stubApi();
    render(<AgentSettings />);

    await screen.findByTestId("agent-settings-action-init:codex");
    await userEvent.click(screen.getByTestId("agent-settings-action-init:codex"));
    await userEvent.click(await screen.findByTestId("agent-action-confirm-init:codex"));

    expect(postedRunAction(fetchMock)).toEqual({ action: "init:codex" });
  });

  it("says so when the actions endpoint is unreachable, instead of showing nothing", async () => {
    // An empty workspace and a broken server rendered identically before: both
    // were a section that simply was not there.
    stubApi(SERVED_ACTIONS, { actionsFails: true });
    render(<AgentSettings />);

    expect(await screen.findByTestId("agent-settings-actions-error")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-settings-action-setup")).toBeNull();
  });

  it("renders no actions section at all for a workspace that offers none", async () => {
    stubApi([]);
    render(<AgentSettings />);

    await screen.findByRole("heading", { level: 1, name: "Settings" });
    expect(screen.queryByTestId("agent-settings-actions-error")).toBeNull();
    expect(screen.queryAllByTestId(/^agent-settings-action-/)).toHaveLength(0);
  });
});
