/**
 * `useEngineInfo`: overlapping refreshes (the mount fetch and the one after a
 * key save) must settle on the latest request's answer, whatever order the
 * responses arrive in.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEngineInfo, type EngineInfo } from "../useEngineInfo";

function engine(state: EngineInfo["status"]["state"]): EngineInfo {
  return { id: "elevenlabs", label: "ElevenLabs", keyed: true, keySource: "file", status: { state } };
}

/** A fetch whose every call waits until the test resolves it. */
function deferredFetch() {
  const pending: ((res: Response) => void)[] = [];
  const fetchMock = vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve)));
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, pending };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useEngineInfo", () => {
  it("a superseded response does not overwrite the latest one", async () => {
    const { fetchMock, pending } = deferredFetch();
    const { result } = renderHook(() => useEngineInfo());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    let second!: Promise<void>;
    act(() => {
      second = result.current.refresh();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // The newer request answers first, the older one after it.
    await act(async () => {
      pending[1](Response.json([engine("ready")]));
      await second;
    });
    expect(result.current.engines?.elevenlabs.status.state).toBe("ready");

    await act(async () => {
      pending[0](Response.json([engine("quota-exhausted")]));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.engines?.elevenlabs.status.state).toBe("ready");
    expect(result.current.failed).toBe(false);
  });

  it("a superseded failure does not mark the latest answer failed", async () => {
    const { fetchMock, pending } = deferredFetch();
    const { result } = renderHook(() => useEngineInfo());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    let second!: Promise<void>;
    act(() => {
      second = result.current.refresh();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await act(async () => {
      pending[1](Response.json([engine("ready")]));
      await second;
    });
    await act(async () => {
      pending[0](new Response("boom", { status: 500 }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.failed).toBe(false);
    expect(result.current.engines?.elevenlabs.status.state).toBe("ready");
  });
});
