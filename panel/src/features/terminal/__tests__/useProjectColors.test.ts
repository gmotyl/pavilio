import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PROJECT_COLOR_PLACEHOLDER,
  useProjectColors,
  __resetProjectColorsForTests,
} from "../useProjectColors";

const COLORS_URL = "/api/projects/colors";

const STORED: Record<string, string> = {
  alpha: "#f0c674",
  beta: "#e06c75",
};

let fetchMock: ReturnType<typeof vi.fn>;
/** Resolves a deliberately held-open colours GET, so the pre-load render is observable. */
let releaseColors: (() => void) | null = null;

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

/**
 * Install a fetch spy. `putOk` decides whether the write endpoint succeeds;
 * `deferGet` holds the colours GET open until `releaseColors()` is called.
 */
function installFetch({
  putOk = true,
  deferGet = false,
}: { putOk?: boolean; deferGet?: boolean } = {}) {
  releaseColors = null;
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === COLORS_URL) {
      if (!deferGet) return jsonResponse({ colors: { ...STORED } });
      return await new Promise<Response>((resolve) => {
        releaseColors = () => resolve(jsonResponse({ colors: { ...STORED } }));
      });
    }
    if (url.endsWith("/color")) {
      return putOk
        ? jsonResponse({ ok: true })
        : jsonResponse({ error: "store failed" }, false, 500);
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
}

/** Every request made to the shared colours endpoint. */
function colorReads() {
  return fetchMock.mock.calls.filter(([u]) => String(u) === COLORS_URL);
}

/** Every write request. */
function colorWrites() {
  return fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/color"));
}

describe("useProjectColors", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  /**
   * Mount one independent consumer — its own React tree, exactly as a chip, a
   * cell header and a drawer row are — recording the colour it saw on every
   * render so an optimistic value that was never painted cannot hide.
   */
  function mountConsumer(project: string, strict = false) {
    const renders: string[] = [];
    const view = renderHook(
      () => {
        const api = useProjectColors();
        const color = api.colorFor(project);
        renders.push(color);
        return { ...api, color };
      },
      strict ? { wrapper: StrictMode } : undefined,
    );
    return { ...view, renders };
  }

  beforeEach(() => {
    __resetProjectColorsForTests();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    installFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    releaseColors = null;
  });

  /**
   * React shouts "The result of getSnapshot should be cached to avoid an
   * infinite loop" through console.error when a store hands back a fresh
   * object on every read — the likeliest way to get this hook wrong.
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

  it("fetches once across multiple consumers", async () => {
    // StrictMode is the real runtime here (the panel has no production build),
    // so the double-invoked effect must not buy a second request either.
    let a!: ReturnType<typeof mountConsumer>;
    let b!: ReturnType<typeof mountConsumer>;
    let c!: ReturnType<typeof mountConsumer>;
    await act(async () => {
      a = mountConsumer("alpha", true);
      b = mountConsumer("alpha", true);
      c = mountConsumer("beta", true);
    });

    expect(colorReads()).toHaveLength(1);
    expect(a.result.current.color).toBe("#f0c674");
    expect(b.result.current.color).toBe("#f0c674");
    expect(c.result.current.color).toBe("#e06c75");

    // Unmounting every consumer must drop every subscription, and a later
    // mount must not re-fetch what the store already holds.
    a.unmount();
    b.unmount();
    c.unmount();
    let d!: ReturnType<typeof mountConsumer>;
    await act(async () => {
      d = mountConsumer("alpha");
    });
    expect(colorReads()).toHaveLength(1);
    expect(d.result.current.color).toBe("#f0c674");

    expectNoSnapshotWarning();
  });

  it("returns a placeholder for an unknown project", async () => {
    installFetch({ deferGet: true });

    let ghost!: ReturnType<typeof mountConsumer>;
    await act(async () => {
      ghost = mountConsumer("ghost");
    });

    // Before the map arrives, every project is unknown.
    expect(ghost.result.current.color).toBe(PROJECT_COLOR_PLACEHOLDER);

    await act(async () => {
      releaseColors?.();
    });

    // Still unknown once loaded: a placeholder, never a borrowed colour.
    expect(ghost.result.current.color).toBe(PROJECT_COLOR_PLACEHOLDER);
    expect(ghost.result.current.colors.ghost).toBeUndefined();
    // Stable: one fixed token across every render, never a per-call value.
    expect(new Set(ghost.renders)).toEqual(
      new Set([PROJECT_COLOR_PLACEHOLDER]),
    );

    expectNoSnapshotWarning();
  });

  it("updates every consumer when a colour is set", async () => {
    let a!: ReturnType<typeof mountConsumer>;
    let b!: ReturnType<typeof mountConsumer>;
    await act(async () => {
      a = mountConsumer("alpha");
      b = mountConsumer("alpha");
    });
    expect(a.result.current.color).toBe("#f0c674");

    // Driven from one consumer; the other must move with it.
    await act(async () => {
      await a.result.current.setColor("alpha", "#123456");
    });

    expect(a.result.current.color).toBe("#123456");
    expect(b.result.current.color).toBe("#123456");
    expect(b.result.current.colors.alpha).toBe("#123456");
    // Untouched projects keep their colour.
    expect(b.result.current.colors.beta).toBe("#e06c75");

    const writes = colorWrites();
    expect(writes).toHaveLength(1);
    expect(String(writes[0][0])).toBe("/api/projects/alpha/color");
    const init = writes[0][1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ hex: "#123456" });

    // The server answers `{ ok: true }`, so there is nothing to refetch.
    expect(colorReads()).toHaveLength(1);

    expectNoSnapshotWarning();
  });

  it("rolls back when the update fails", async () => {
    installFetch({ putOk: false });

    let a!: ReturnType<typeof mountConsumer>;
    let b!: ReturnType<typeof mountConsumer>;
    await act(async () => {
      a = mountConsumer("alpha");
      b = mountConsumer("alpha");
    });
    const rendersBeforeWrite = a.renders.length;

    await act(async () => {
      await expect(
        a.result.current.setColor("alpha", "#123456"),
      ).rejects.toThrow();
    });

    // Optimistic first — the UI must actually have painted the new colour...
    expect(a.renders.slice(rendersBeforeWrite)).toContain("#123456");
    // ...and every consumer must end up back on the stored one.
    expect(a.result.current.color).toBe("#f0c674");
    expect(b.result.current.color).toBe("#f0c674");
    expect(b.result.current.colors.alpha).toBe("#f0c674");

    expectNoSnapshotWarning();
  });
});
