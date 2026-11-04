/**
 * Settings → "Copy preferences from <machine>" (design D4): lists the other
 * machines with a committed preferences file, and on a confirmed pick asks the
 * server to replace this machine's document, then reloads the page — the
 * preferences are read once at boot (ADR-0015), so a reload is how the copied
 * values reach the UI.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CopyPreferencesSection } from "../CopyPreferencesSection";

function stubApi(machines: string[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/preferences/machines") {
      return new Response(JSON.stringify({ self: "spock", machines }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url === "/api/preferences/copy-from" && init?.method === "POST") {
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const copyCalls = (fetchMock: ReturnType<typeof stubApi>) =>
  fetchMock.mock.calls.filter(([url]) => String(url) === "/api/preferences/copy-from");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CopyPreferencesSection", () => {
  it("section lists other machines and copies after confirmation", async () => {
    const fetchMock = stubApi(["mac", "zx-81"]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const reload = vi.fn();
    render(<CopyPreferencesSection reload={reload} />);

    expect(await screen.findByRole("button", { name: "Copy preferences from mac" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy preferences from zx-81" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Copy preferences from mac" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain("mac");
    const calls = copyCalls(fetchMock);
    expect(calls).toHaveLength(1);
    expect(calls[0][1]?.method).toBe("POST");
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ machine: "mac" });
    // Asked first, copied second, reloaded last.
    expect(confirm.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[1]);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("section shows a none-state when no other machine has committed preferences", async () => {
    stubApi([]);
    render(<CopyPreferencesSection reload={vi.fn()} />);

    expect(await screen.findByText(/No other machine has committed preferences/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Copy preferences from/ })).toBeNull();
  });

  it("cancelling the confirmation changes nothing", async () => {
    const fetchMock = stubApi(["mac"]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const reload = vi.fn();
    render(<CopyPreferencesSection reload={reload} />);

    await userEvent.click(await screen.findByRole("button", { name: "Copy preferences from mac" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(copyCalls(fetchMock)).toHaveLength(0);
    expect(reload).not.toHaveBeenCalled();
  });
});
