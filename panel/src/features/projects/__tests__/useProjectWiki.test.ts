import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../realtime/useWebSocket", () => ({
  useWebSocket: () => ({ lastMessage: null }),
}));

import { useProjectWiki } from "../useProjectWiki";

type Pending = { url: string; resolve: (body: unknown) => void };

/** fetch whose responses the test releases by hand, in any order. */
function deferredFetch() {
  const pending: Pending[] = [];
  const fn = vi.fn(
    (url: string) =>
      new Promise<Response>((resolve) => {
        pending.push({ url, resolve: (body) => resolve(new Response(JSON.stringify(body), { status: 200 })) });
      }),
  );
  return { fn, pending };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useProjectWiki", () => {
  it("drops a slower response for the previous project", async () => {
    const { fn, pending } = deferredFetch();
    vi.stubGlobal("fetch", fn);
    const { result, rerender } = renderHook(({ name }) => useProjectWiki(name), { initialProps: { name: "alpha" } });
    await waitFor(() => expect(pending).toHaveLength(1));

    rerender({ name: "beta" });
    // The previous project's data never shows under the new project.
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(pending).toHaveLength(2));

    await act(async () => pending[1].resolve({ project: "beta" }));
    await act(async () => pending[0].resolve({ project: "alpha" }));

    expect(pending[0].url).toBe("/api/projects/alpha/wiki");
    expect(result.current.data).toEqual({ project: "beta" });
    expect(result.current.loading).toBe(false);
  });

  it("clears the previous project's tree when the project changes", async () => {
    const { fn, pending } = deferredFetch();
    vi.stubGlobal("fetch", fn);
    const { result, rerender } = renderHook(({ name }) => useProjectWiki(name), { initialProps: { name: "alpha" } });
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0].resolve({ project: "alpha" }));
    expect(result.current.data).toEqual({ project: "alpha" });

    rerender({ name: "beta" });
    expect(result.current.data).toBeNull();
  });
});
