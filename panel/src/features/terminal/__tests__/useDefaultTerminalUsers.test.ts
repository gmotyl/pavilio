import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useDefaultTerminalUsers,
  __resetDefaultTerminalUsersForTests,
} from "../useDefaultTerminalUsers";

const DEFAULT_USERS_URL = "/api/projects/default-terminal-users";

const STORED: Record<string, string> = {
  alpha: "greg",
  beta: "greg-ip",
};

let fetchMock: ReturnType<typeof vi.fn>;
/** Resolves a deliberately held-open GET, so the pre-load render is observable. */
let releaseUsers: (() => void) | null = null;

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

/**
 * Install a fetch spy. `putOk` decides whether the write endpoint succeeds;
 * `deferGet` holds the GET open until `releaseUsers()` is called.
 */
function installFetch({
  putOk = true,
  deferGet = false,
}: { putOk?: boolean; deferGet?: boolean } = {}) {
  releaseUsers = null;
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === DEFAULT_USERS_URL) {
      if (!deferGet) return jsonResponse({ users: { ...STORED } });
      return await new Promise<Response>((resolve) => {
        releaseUsers = () =>
          resolve(jsonResponse({ users: { ...STORED } }));
      });
    }
    if (url.endsWith("/default-terminal-user")) {
      return putOk
        ? jsonResponse({ ok: true })
        : jsonResponse({ error: "store failed" }, false, 500);
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
}

/** Every request made to the shared default-terminal-users endpoint. */
function userReads() {
  return fetchMock.mock.calls.filter(([u]) => String(u) === DEFAULT_USERS_URL);
}

describe("useDefaultTerminalUsers", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  function mountConsumer(strict = false) {
    const view = renderHook(
      () => useDefaultTerminalUsers(),
      strict ? { wrapper: StrictMode } : undefined,
    );
    return view;
  }

  beforeEach(() => {
    __resetDefaultTerminalUsersForTests();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    installFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    releaseUsers = null;
  });

  function expectNoSnapshotWarning() {
    const messages = consoleError.mock.calls.map((args: unknown[]) =>
      args.join(" "),
    );
    expect(messages.filter((m: string) => m.includes("getSnapshot"))).toEqual(
      [],
    );
    expect(messages).toEqual([]);
  }

  it("fetches the default-users map only once across two mounted consumers", async () => {
    let a!: ReturnType<typeof mountConsumer>;
    let b!: ReturnType<typeof mountConsumer>;
    await act(async () => {
      a = mountConsumer(true);
      b = mountConsumer(true);
    });

    expect(userReads()).toHaveLength(1);
    expect(a.result.current.defaultUsers).toEqual(STORED);
    expect(b.result.current.defaultUsers).toEqual(STORED);

    a.unmount();
    b.unmount();
    let c!: ReturnType<typeof mountConsumer>;
    await act(async () => {
      c = mountConsumer();
    });
    expect(userReads()).toHaveLength(1);
    expect(c.result.current.defaultUsers).toEqual(STORED);

    expectNoSnapshotWarning();
  });

  it("returns an empty map before the fetch resolves", async () => {
    installFetch({ deferGet: true });

    let view!: ReturnType<typeof mountConsumer>;
    await act(async () => {
      view = mountConsumer();
    });

    expect(view.result.current.defaultUsers).toEqual({});

    await act(async () => {
      releaseUsers?.();
    });

    expect(view.result.current.defaultUsers).toEqual(STORED);

    expectNoSnapshotWarning();
  });

  it("setDefaultUser updates the map optimistically before the request resolves", async () => {
    // Held open so the optimistic value is observable before the write settles.
    const pending = new Map<string, (res: Response) => void>();
    const deferredFetch = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = String(input);
        if (url === DEFAULT_USERS_URL)
          return jsonResponse({ users: { ...STORED } });
        const match = /\/api\/projects\/([^/]+)\/default-terminal-user$/.exec(
          url,
        );
        if (match) {
          const project = decodeURIComponent(match[1]);
          return await new Promise<Response>((resolve) => {
            pending.set(project, resolve);
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    );
    vi.stubGlobal("fetch", deferredFetch);

    let a!: ReturnType<typeof mountConsumer>;
    await act(async () => {
      a = mountConsumer();
    });
    expect(a.result.current.defaultUsers.alpha).toBe("greg");

    let write!: Promise<void>;
    await act(async () => {
      write = a.result.current.setDefaultUser("alpha", "greg-ip");
    });

    // Optimistic: reflects the new value before the PUT resolves.
    expect(a.result.current.defaultUsers.alpha).toBe("greg-ip");

    await act(async () => {
      pending.get("alpha")?.(jsonResponse({ ok: true }));
      await write;
    });

    expect(a.result.current.defaultUsers.alpha).toBe("greg-ip");
    const writes = deferredFetch.mock.calls.filter(([u]) =>
      String(u).endsWith("/default-terminal-user"),
    );
    expect(writes).toHaveLength(1);
    expect(String(writes[0][0])).toBe(
      "/api/projects/alpha/default-terminal-user",
    );
    const init = writes[0][1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ username: "greg-ip" });

    expectNoSnapshotWarning();
  });

  it("setDefaultUser rolls back the map and rejects when the request fails", async () => {
    installFetch({ putOk: false });

    let a!: ReturnType<typeof mountConsumer>;
    let b!: ReturnType<typeof mountConsumer>;
    await act(async () => {
      a = mountConsumer();
      b = mountConsumer();
    });
    expect(a.result.current.defaultUsers.alpha).toBe("greg");

    await act(async () => {
      await expect(
        a.result.current.setDefaultUser("alpha", "greg-ip"),
      ).rejects.toThrow();
    });

    // Rolled back on both consumers.
    expect(a.result.current.defaultUsers.alpha).toBe("greg");
    expect(b.result.current.defaultUsers.alpha).toBe("greg");
    // Untouched projects keep their value.
    expect(b.result.current.defaultUsers.beta).toBe("greg-ip");

    expectNoSnapshotWarning();
  });

  it("rolling back a project that had no stored default removes the key", async () => {
    installFetch({ putOk: false });

    let view!: ReturnType<typeof mountConsumer>;
    await act(async () => {
      view = mountConsumer();
    });
    expect("gamma" in view.result.current.defaultUsers).toBe(false);

    await act(async () => {
      await expect(
        view.result.current.setDefaultUser("gamma", "greg-ip"),
      ).rejects.toThrow();
    });

    expect("gamma" in view.result.current.defaultUsers).toBe(false);
    expect(view.result.current.defaultUsers).toEqual(STORED);

    expectNoSnapshotWarning();
  });
});
