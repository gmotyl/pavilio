import { describe, expect, it } from "vitest";
import type { SpeechCacheState } from "../../speech/synth";
import { segmentStateFor } from "../segmentState";

const caches: SpeechCacheState[] = ["cold", "warming", "ready"];

describe("segmentStateFor", () => {
  it("the playing index is playing and everything before it is played", () => {
    for (const cache of caches) {
      expect(segmentStateFor({ index: 3, playingIndex: 3, cache })).toBe("playing");
      expect(segmentStateFor({ index: 0, playingIndex: 3, cache })).toBe("played");
      expect(segmentStateFor({ index: 2, playingIndex: 3, cache })).toBe("played");
    }
  });

  it("a run that has just started: index 0 is playing, and played once the playhead moves on", () => {
    for (const cache of caches) {
      expect(segmentStateFor({ index: 0, playingIndex: 0, cache })).toBe("playing");
      expect(segmentStateFor({ index: 0, playingIndex: 1, cache })).toBe("played");
    }
  });

  it("ahead of the playhead the cache decides", () => {
    for (const cache of caches) {
      expect(segmentStateFor({ index: 4, playingIndex: 3, cache })).toBe(cache);
      expect(segmentStateFor({ index: 9, playingIndex: 0, cache })).toBe(cache);
    }
  });

  it("with no run the cache decides for every index", () => {
    for (const cache of caches) {
      for (const index of [0, 1, 5]) {
        expect(segmentStateFor({ index, playingIndex: null, cache })).toBe(cache);
      }
    }
  });
});
