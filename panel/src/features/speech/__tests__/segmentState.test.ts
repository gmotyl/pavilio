import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpeechUnit } from "../types";

/**
 * Where a unit's cache state comes from: a page's unit asks the page audio
 * cache first (on disk, fetched or not), then the synthesizer; an answer's
 * unit asks the synthesizer alone. Both modules are mocked — never anytts.
 */
const page = vi.hoisted(() => ({
  pageUnitState: vi.fn((): "warming" | "ready" | undefined => undefined),
  subscribePageCache: vi.fn((_listener: () => void) => () => {}),
}));
const synth = vi.hoisted(() => ({
  speechCacheState: vi.fn((): "cold" | "warming" | "ready" => "cold"),
  subscribeSpeechCache: vi.fn((_listener: () => void) => () => {}),
}));

vi.mock("../pageCache", () => page);
vi.mock("../synth", () => synth);

import { subscribeUnitCache, unitCacheState } from "../segmentState";

const DOC = "doc:p/wiki/page.md";
const unit: SpeechUnit = { text: "On disk.", chars: 8, source: "On disk." };

beforeEach(() => {
  vi.clearAllMocks();
  page.pageUnitState.mockReturnValue(undefined);
  synth.speechCacheState.mockReturnValue("cold");
});

describe("unitCacheState", () => {
  it("a doc segment on disk is warming until fetched", () => {
    // Listed by the server, bytes not yet in hand: warming, though the
    // synthesizer has never heard of it.
    page.pageUnitState.mockReturnValue("warming");
    expect(unitCacheState(DOC, unit, "v")).toBe("warming");

    page.pageUnitState.mockReturnValue("ready");
    expect(unitCacheState(DOC, unit, "v")).toBe("ready");
    expect(synth.speechCacheState).not.toHaveBeenCalled();
  });

  it("a doc segment not on disk asks the synthesizer", () => {
    synth.speechCacheState.mockReturnValue("ready");

    expect(unitCacheState(DOC, unit, "v")).toBe("ready");
    expect(synth.speechCacheState).toHaveBeenCalledWith(unit.text, { voice: "v", lang: unit.lang });
  });

  it("an answer segment never asks the page cache", () => {
    synth.speechCacheState.mockReturnValue("warming");

    expect(unitCacheState("cell-a", unit, "v")).toBe("warming");
    expect(unitCacheState("cell-a", undefined, "v")).toBe("cold");
    expect(page.pageUnitState).not.toHaveBeenCalled();
  });

  it("a subscriber hears both caches", () => {
    const listener = vi.fn();
    const unsubscribePage = vi.fn();
    const unsubscribeSynth = vi.fn();
    page.subscribePageCache.mockReturnValue(unsubscribePage);
    synth.subscribeSpeechCache.mockReturnValue(unsubscribeSynth);

    const unsubscribe = subscribeUnitCache(listener);
    page.subscribePageCache.mock.calls[0][0]();
    synth.subscribeSpeechCache.mock.calls[0][0]();
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(unsubscribePage).toHaveBeenCalled();
    expect(unsubscribeSynth).toHaveBeenCalled();
  });
});
