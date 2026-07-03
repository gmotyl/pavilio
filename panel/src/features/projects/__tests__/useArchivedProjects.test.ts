import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useArchivedProjects } from "../useArchivedProjects";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

describe("useArchivedProjects (API-backed)", () => {
  it("loads archived list from GET /api/archive", async () => {
    fetchMock.mockReturnValueOnce(
      jsonResponse([{ name: "beta", archivedAt: "2026-07-03T00:00:00.000Z" }]),
    );
    const { result } = renderHook(() => useArchivedProjects());
    await waitFor(() => expect(result.current.archived).toHaveLength(1));
    expect(result.current.isArchived("beta")).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/archive");
  });

  it("archive() POSTs then refreshes", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse([]))                     // initial GET
      .mockReturnValueOnce(jsonResponse({ ok: true }))           // POST archive
      .mockReturnValueOnce(
        jsonResponse([{ name: "alpha", archivedAt: "2026-07-03T00:00:00.000Z" }]),
      );                                                         // refresh GET
    const { result } = renderHook(() => useArchivedProjects());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(() => result.current.archive("alpha"));
    expect(fetchMock).toHaveBeenCalledWith("/api/archive/alpha", { method: "POST" });
    await waitFor(() => expect(result.current.archivedNames.has("alpha")).toBe(true));
  });

  it("restore() POSTs then refreshes", async () => {
    fetchMock
      .mockReturnValueOnce(
        jsonResponse([{ name: "beta", archivedAt: "2026-07-03T00:00:00.000Z" }]),
      )
      .mockReturnValueOnce(jsonResponse({ ok: true }))
      .mockReturnValueOnce(jsonResponse([]));
    const { result } = renderHook(() => useArchivedProjects());
    await waitFor(() => expect(result.current.archived).toHaveLength(1));
    await act(() => result.current.restore("beta"));
    expect(fetchMock).toHaveBeenCalledWith("/api/archive/beta/restore", { method: "POST" });
    await waitFor(() => expect(result.current.archived).toHaveLength(0));
  });

  it("surfaces server errors", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse([]))
      .mockReturnValueOnce(jsonResponse({ error: "Already archived: alpha" }, 409));
    const { result } = renderHook(() => useArchivedProjects());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(() => result.current.archive("alpha"));
    expect(result.current.error).toBe("Already archived: alpha");
  });

  it("clears error after a subsequent successful refresh", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse({ error: "boom" }, 500)) // initial GET fails
      .mockReturnValueOnce(jsonResponse([]));                    // manual refresh succeeds
    const { result } = renderHook(() => useArchivedProjects());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    await act(() => result.current.refresh());
    expect(result.current.error).toBeNull();
  });
});
