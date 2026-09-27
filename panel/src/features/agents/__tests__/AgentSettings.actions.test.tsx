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

/** Routes the two GETs the page makes; anything else is a test bug. */
function stubApi(actions: unknown = SERVED_ACTIONS) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/agent-settings/actions")) {
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
});
