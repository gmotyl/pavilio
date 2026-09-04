import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOsUsers, __resetOsUsersForTests } from "../useOsUsers";

const OS_USERS_URL = "/api/terminal/os-users";

const STORED: { username: string }[] = [
  { username: "greg" },
  { username: "greg-ip" },
];

let fetchMock: ReturnType<typeof vi.fn>;
/** Resolves a deliberately held-open os-users GET, so the pre-load render is observable. */
let releaseUsers: (() => void) | null = null;

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

function installFetch({ deferGet = false }: { deferGet?: boolean } = {}) {
  releaseUsers = null;
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === OS_USERS_URL) {
      if (!deferGet) return jsonResponse([...STORED]);
      return await new Promise<Response>((resolve) => {
        releaseUsers = () => resolve(jsonResponse([...STORED]));
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
}

/** Every request made to the shared os-users endpoint. */
function osUserReads() {
  return fetchMock.mock.calls.filter(([u]) => String(u) === OS_USERS_URL);
}

describe("useOsUsers", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  /**
   * Mount one independent consumer — its own React tree, exactly as the
   * toolbar dropdown and any other reader would be.
   */
  function mountConsumer(strict = false) {
    const view = renderHook(
      () => useOsUsers(),
      strict ? { wrapper: StrictMode } : undefined,
    );
    return view;
  }

  beforeEach(() => {
    __resetOsUsersForTests();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    installFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    releaseUsers = null;
  });

  /**
   * React shouts "The result of getSnapshot should be cached to avoid an
   * infinite loop" through console.error when a store hands back a fresh
   * object/array on every read.
   */
  function expectNoSnapshotWarning() {
    const messages = consoleError.mock.calls.map((args: unknown[]) =>
      args.join(" "),
    );
    expect(messages.filter((m: string) => m.includes("getSnapshot"))).toEqual(
      [],
    );
    expect(messages).toEqual([]);
  }

  it("fetches the user list only once across two mounted consumers", async () => {
    // StrictMode is the real runtime here (the panel has no production build),
    // so the double-invoked effect must not buy a second request either.
    let a!: ReturnType<typeof mountConsumer>;
    let b!: ReturnType<typeof mountConsumer>;
    await act(async () => {
      a = mountConsumer(true);
      b = mountConsumer(true);
    });

    expect(osUserReads()).toHaveLength(1);
    expect(a.result.current.users).toEqual(STORED);
    expect(b.result.current.users).toEqual(STORED);

    // Unmounting every consumer must drop every subscription, and a later
    // mount must not re-fetch what the store already holds.
    a.unmount();
    b.unmount();
    let c!: ReturnType<typeof mountConsumer>;
    await act(async () => {
      c = mountConsumer();
    });
    expect(osUserReads()).toHaveLength(1);
    expect(c.result.current.users).toEqual(STORED);

    expectNoSnapshotWarning();
  });

  it("returns an empty list before the fetch resolves", async () => {
    installFetch({ deferGet: true });

    let view!: ReturnType<typeof mountConsumer>;
    await act(async () => {
      view = mountConsumer();
    });

    expect(view.result.current.users).toEqual([]);

    await act(async () => {
      releaseUsers?.();
    });

    expect(view.result.current.users).toEqual(STORED);

    expectNoSnapshotWarning();
  });
});
