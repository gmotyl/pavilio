import { describe, expect, it } from "vitest";
import { SCAN_WINDOW, firstUnitsOfBlocks } from "../PlayFromHere";
import type { SpeechUnit } from "../types";

/** A unit built by hand: one per block unless `block` says otherwise. */
function unit(source: string, block: number): SpeechUnit {
  return { text: source, chars: source.length, source, block };
}

function fillers(count: number, from = 0): SpeechUnit[] {
  return Array.from({ length: count }, (_, i) => unit(`filler sentence number ${from + i} sits here.`, from + i));
}

describe("firstUnitsOfBlocks", () => {
  it("an exact match lands however far past the cursor it is", () => {
    const units = [...fillers(SCAN_WINDOW * 3), unit("The target heading text", SCAN_WINDOW * 3)];
    expect(firstUnitsOfBlocks(units, ["The target heading text"])).toEqual([SCAN_WINDOW * 3]);
  });

  it("a partial match is looked for only within the scan window", () => {
    const holder = "The paragraph that holds the block text and more words after it.";
    const near = [...fillers(10), unit(holder, 10)];
    expect(firstUnitsOfBlocks(near, ["holds the block text and more"])).toEqual([10]);

    const far = [...fillers(SCAN_WINDOW + 10), unit(holder, SCAN_WINDOW + 10)];
    expect(firstUnitsOfBlocks(far, ["holds the block text and more"])).toEqual([null]);
  });

  it("snaps to the first unit of a block cut into several, and moves past all of them", () => {
    const units = [
      unit("Intro heading here", 0),
      unit("First sentence of the long block is here.", 1),
      unit("Second sentence of the long block is here.", 1),
      unit("Intro heading here", 2),
    ];
    expect(
      firstUnitsOfBlocks(units, ["Intro heading here", "Second sentence of the long block is here.", "Intro heading here"]),
    ).toEqual([0, 1, 3]);
  });

  it("a page of thousands of blocks maps in order", () => {
    const count = 3000;
    const units = Array.from({ length: count }, (_, i) => unit(`Block ${i} says ${i % 7 === 0 ? "the same" : `its own ${i}`} thing.`, i));
    // Every third rendered block matches nothing (a code-ish paragraph).
    const texts = units.map((u, i) => (i % 3 === 0 ? "`x`" : u.source));
    const mapped = firstUnitsOfBlocks(units, texts);
    expect(mapped).toEqual(texts.map((_, i) => (i % 3 === 0 ? null : i)));
  });
});
