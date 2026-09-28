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
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AgentSettings from "../AgentSettings";

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Wait until the component's `/api/agent-settings/actions` request has not only
 * been made but fully settled, including the `.then`/`.catch` that sets state.
 * Tests asserting that nothing rendered need this: "not yet" and "never" are
 * the same DOM.
 */
async function settleActions(fetchMock: ReturnType<typeof vi.fn>) {
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith("/api/agent-settings/actions"),
  );
  await act(async () => {
    await Promise.allSettled(fetchMock.mock.results.map((r) => r.value));
  });
}

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
  opts: { actionsFails?: boolean; actionsStatus?: number } = {},
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/agent-settings/run-action")) {
      expect(init?.method).toBe("POST");
      return { ok: true, json: async () => ({ ok: true, output: "ran" }) } as unknown as Response;
    }
    if (url.startsWith("/api/agent-settings/actions")) {
      if (opts.actionsFails) throw new Error("connection refused");
      // A server that answers with a status is a different failure from one
      // that does not answer, and the page has to tell them apart.
      if (opts.actionsStatus) {
        return { ok: false, status: opts.actionsStatus, json: async () => ({}) } as unknown as Response;
      }
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
    const fetchMock = stubApi([]);
    render(<AgentSettings />);

    // The heading is gated on the /api/agent-settings fetch alone, and the
    // /actions request is an independent promise — so awaiting the heading
    // proves nothing about it. This test asserts an ABSENCE, which is also
    // what the page looks like before /actions has answered at all: without
    // settling it first, the test passes whether the feature works or not.
    await settleActions(fetchMock);

    expect(screen.queryByTestId("agent-settings-actions-error")).toBeNull();
    expect(screen.queryAllByTestId(/^agent-settings-action-/)).toHaveLength(0);
  });

  it("says the server answered, not that it is down, when /actions 404s", async () => {
    // The realistic shape of this failure is a bundle newer than the server —
    // the endpoint is simply not there yet. Telling the reader to check that
    // the server is running sends them after the one thing that is fine.
    stubApi(SERVED_ACTIONS, { actionsStatus: 404 });
    render(<AgentSettings />);

    const error = await screen.findByTestId("agent-settings-actions-error");
    expect(error).toHaveTextContent("answered 404");
    expect(error).not.toHaveTextContent("did not answer");
  });
});
