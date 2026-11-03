import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { jsonResponse, stubFetch } from "../../../test-utils";
import {
  __resetOpenaiVoicesForTests,
  currentOpenaiVoices,
  reloadOpenaiVoices,
  useOpenaiVoices,
} from "../useOpenaiVoices";
import {
  catalogDefaultVoice,
  getProjectVoices,
  getStoredVoices,
  resolveStoredVoice,
  setEngineVoice,
  setProjectEngineVoice,
  voiceFor,
} from "../voices";
import { EN_MALE, LIVE_VOICES, MY_VOICE, OPENAI_VOICES_URL, PL_FEMALE, voicesBody } from "./openaiVoiceFixtures";

afterEach(() => {
  __resetOpenaiVoicesForTests();
});

describe("useOpenaiVoices", () => {
  it("hook loads voices and reloads on demand", async () => {
    let body = voicesBody(LIVE_VOICES, 2);
    const fetchMock = stubFetch({ [OPENAI_VOICES_URL]: () => jsonResponse(body) });
    const first = renderHook(() => useOpenaiVoices());
    const second = renderHook(() => useOpenaiVoices());

    await waitFor(() => expect(first.result.current.voices).toEqual(LIVE_VOICES));
    expect(first.result.current.unreachable).toBe(false);
    expect(first.result.current.workspaceOnly).toBe(2);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith(OPENAI_VOICES_URL))).toBe(true);

    // A voice deleted in Settings: one reload, and every consumer shows the new list.
    body = voicesBody([MY_VOICE, EN_MALE]);
    await act(() => first.result.current.reload());
    expect(first.result.current.voices).toEqual([MY_VOICE, EN_MALE]);
    expect(second.result.current.voices).toEqual([MY_VOICE, EN_MALE]);
    expect(first.result.current.workspaceOnly).toBe(0);
    expect(currentOpenaiVoices()).toEqual([MY_VOICE, EN_MALE]);
  });

  it("a 502 marks the list unreachable and keeps the last one", async () => {
    let down = false;
    stubFetch({
      [OPENAI_VOICES_URL]: () =>
        down ? jsonResponse({ error: "unreachable" }, { status: 502 }) : jsonResponse(voicesBody()),
    });
    const { result } = renderHook(() => useOpenaiVoices());
    await waitFor(() => expect(result.current.voices).toEqual(LIVE_VOICES));

    down = true;
    await act(() => result.current.reload());
    expect(result.current.unreachable).toBe(true);
    expect(result.current.voices).toEqual(LIVE_VOICES);
  });

  it("loaded turns true once the first answer lands, a 502 or a 409 included", async () => {
    let status = 502;
    let answer: (res: Response) => void = () => {};
    stubFetch({
      [OPENAI_VOICES_URL]: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    const { result } = renderHook(() => useOpenaiVoices());
    expect(result.current.loaded).toBe(false);
    await act(async () => answer(jsonResponse({ error: "unreachable" }, { status })));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.unreachable).toBe(true);

    status = 409;
    const reloading = result.current.reload();
    await act(async () => {
      answer(jsonResponse({ error: "no-address" }, { status }));
      await reloading;
    });
    expect(result.current.loaded).toBe(true);
    expect(result.current.voices).toEqual([]);
  });

  it("a window focus while unreachable reloads the list", async () => {
    let down = true;
    const fetchMock = stubFetch({
      [OPENAI_VOICES_URL]: () =>
        down ? jsonResponse({ error: "unreachable" }, { status: 502 }) : jsonResponse(voicesBody()),
    });
    const calls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith(OPENAI_VOICES_URL)).length;
    const { result } = renderHook(() => useOpenaiVoices());
    await waitFor(() => expect(result.current.unreachable).toBe(true));
    expect(calls()).toBe(1);

    // OmniVoice started meanwhile: coming back to the window picks it up.
    down = false;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(result.current.voices).toEqual(LIVE_VOICES));
    expect(result.current.unreachable).toBe(false);
    expect(calls()).toBe(2);

    // Reachable: a focus asks for nothing.
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(calls()).toBe(2);
  });

  it("a failed first load (no answer, a 500, an unreadable body) completes with failed set", async () => {
    let mode: "reject" | "500" | "malformed" | "up" = "reject";
    stubFetch({
      [OPENAI_VOICES_URL]: () => {
        if (mode === "reject") return Promise.reject(new TypeError("Failed to fetch"));
        if (mode === "500") return jsonResponse({ error: "boom" }, { status: 500 });
        if (mode === "malformed") return jsonResponse({ nope: true });
        return jsonResponse(voicesBody());
      },
    });
    const { result } = renderHook(() => useOpenaiVoices());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.failed).toBe(true);
    expect(result.current.unreachable).toBe(false);
    expect(result.current.voices).toEqual([]);

    for (const next of ["500", "malformed"] as const) {
      mode = next;
      await act(() => result.current.reload());
      expect(result.current.loaded).toBe(true);
      expect(result.current.failed).toBe(true);
    }

    mode = "up";
    await act(() => result.current.reload());
    expect(result.current.failed).toBe(false);
    expect(result.current.voices).toEqual(LIVE_VOICES);
  });

  it("no address empties the list", async () => {
    let address = true;
    stubFetch({
      [OPENAI_VOICES_URL]: () =>
        address ? jsonResponse(voicesBody()) : jsonResponse({ error: "no-address" }, { status: 409 }),
    });
    const { result } = renderHook(() => useOpenaiVoices());
    await waitFor(() => expect(result.current.voices).toEqual(LIVE_VOICES));

    address = false;
    await act(() => result.current.reload());
    expect(result.current.voices).toEqual([]);
    expect(result.current.unreachable).toBe(false);
  });

  it("a deleted voice id falls back to the default", async () => {
    let body = voicesBody();
    stubFetch({ [OPENAI_VOICES_URL]: () => jsonResponse(body) });
    await reloadOpenaiVoices();

    setEngineVoice("openai", PL_FEMALE.id);
    setProjectEngineVoice("p", "openai", PL_FEMALE.id);
    expect(getStoredVoices().openai).toBe(PL_FEMALE.id);
    expect(voiceFor("openai", "p")).toBe(PL_FEMALE.id);

    // pl-female deleted on the server: the stored ids read as stale, and the default applies.
    body = voicesBody([MY_VOICE, EN_MALE]);
    await reloadOpenaiVoices();
    expect(getStoredVoices().openai).toBeUndefined();
    expect(getProjectVoices("p").openai).toBeUndefined();
    expect(catalogDefaultVoice("openai")).toBe(MY_VOICE.id);
    expect(voiceFor("openai", "p")).toBe(MY_VOICE.id);
    expect(resolveStoredVoice({ openai: PL_FEMALE.id }, "openai")).toEqual({ voice: MY_VOICE.id, fellBack: true });
  });

  it("a server without my-voice defaults to a voice it lists", async () => {
    stubFetch({ [OPENAI_VOICES_URL]: () => jsonResponse(voicesBody([EN_MALE, PL_FEMALE])) });
    await reloadOpenaiVoices();
    // Never an unknown-voice id: the map's my-voice resolves against the live list as the server
    // resolves it (`default` names no language, so the first voice).
    expect(catalogDefaultVoice("openai")).toBe(EN_MALE.id);
  });
});
