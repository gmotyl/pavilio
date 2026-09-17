/**
 * The rail's geometry, without React: `splitSharedSpans` is pure, and
 * `layoutRail` reads only `offsetTop` / `offsetHeight`, which jsdom leaves at
 * zero — so the blocks carry their boxes as data attributes and the getters
 * are stubbed to read them back, the same trick `AnswerPane.test.tsx` uses.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MIN_SEGMENT_HEIGHT,
  SEGMENT_GAP,
  layoutRail,
  splitSharedSpans,
  type Span,
} from "../layoutRail";

describe("splitSharedSpans", () => {
  it("splits an identical span by weight in unit order", () => {
    const shared: Span = { top: 0, bottom: 100 };
    expect(splitSharedSpans([shared, { ...shared }], [60, 40])).toEqual([
      { top: 0, bottom: 60 },
      { top: 60, bottom: 100 },
    ]);
  });

  it("three sharers produce contiguous slices summing to the original", () => {
    const shared: Span = { top: 20, bottom: 120 };
    const result = splitSharedSpans([shared, { ...shared }, { ...shared }], [1, 2, 3]);
    expect(result).toHaveLength(3);
    const slices = result as Span[];
    expect(slices[0].top).toBe(20);
    expect(slices[2].bottom).toBe(120);
    expect(slices[1].top).toBe(slices[0].bottom);
    expect(slices[2].top).toBe(slices[1].bottom);
    const total = slices.reduce((sum, s) => sum + (s.bottom - s.top), 0);
    expect(total).toBeCloseTo(100);
    // Proportional: 1/6, 2/6, 3/6 of 100.
    expect(slices[0].bottom - slices[0].top).toBeCloseTo(100 / 6);
    expect(slices[1].bottom - slices[1].top).toBeCloseTo(200 / 6);
    expect(slices[2].bottom - slices[2].top).toBeCloseTo(300 / 6);
  });

  it("distinct overlapping spans pass through unchanged", () => {
    const spans: Span[] = [
      { top: 0, bottom: 40 },
      { top: 0, bottom: 140 },
      { top: 100, bottom: 180 },
    ];
    expect(splitSharedSpans(spans, [3, 20, 8])).toEqual(spans);
  });

  it("a null span breaks a group and stays null", () => {
    const shared: Span = { top: 0, bottom: 100 };
    expect(splitSharedSpans([shared, null, { ...shared }], [1, 1, 1])).toEqual([
      shared,
      null,
      shared,
    ]);
  });

  it("zero weights split evenly", () => {
    const shared: Span = { top: 0, bottom: 90 };
    expect(splitSharedSpans([shared, { ...shared }, { ...shared }], [0, 0, 0])).toEqual([
      { top: 0, bottom: 30 },
      { top: 30, bottom: 60 },
      { top: 60, bottom: 90 },
    ]);
  });
});

describe("layoutRail", () => {
  const saved: Record<string, PropertyDescriptor | undefined> = {};

  beforeEach(() => {
    for (const name of ["offsetTop", "offsetHeight"]) {
      saved[name] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
    }
    Object.defineProperty(HTMLElement.prototype, "offsetTop", {
      configurable: true,
      get(this: HTMLElement) {
        return Number(this.dataset.top ?? 0);
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return Number(this.dataset.height ?? 0);
      },
    });
  });

  afterEach(() => {
    for (const [name, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    }
    document.body.innerHTML = "";
  });

  function build(blocks: { top: number; height: number }[], units: number) {
    const body = document.createElement("div");
    const prose = document.createElement("div");
    prose.className = "prose";
    for (const b of blocks) {
      const block = document.createElement("p");
      block.dataset.top = String(b.top);
      block.dataset.height = String(b.height);
      prose.appendChild(block);
    }
    const rail = document.createElement("div");
    rail.dataset.top = "0";
    for (let i = 0; i < units; i++) rail.appendChild(document.createElement("button"));
    body.append(prose, rail);
    document.body.appendChild(body);
    const box = (i: number) => {
      const seg = rail.children[i] as HTMLElement;
      return { top: parseFloat(seg.style.top), height: parseFloat(seg.style.height) };
    };
    return { body, rail, box };
  }

  it("layoutRail places a second sharer inside the block instead of a stub below it", () => {
    // Blocks 0..3 stacked 100px apart, 80px tall. Units 3 and 4 both own block 3
    // (a long paragraph cut in two at the ceiling), 60/40 by chars.
    const { body, rail, box } = build(
      [
        { top: 0, height: 80 },
        { top: 100, height: 80 },
        { top: 200, height: 80 },
        { top: 300, height: 80 },
      ],
      5,
    );
    layoutRail(
      body,
      rail,
      [[0], [1], [2], [3], [3]],
      [{ chars: 10 }, { chars: 10 }, { chars: 10 }, { chars: 60 }, { chars: 40 }],
    );

    expect(box(2)).toEqual({ top: 200, height: 80 });
    // Unit 3 takes the top 60% of block 3, unit 4 the remaining 40% — inside
    // the block, not an 8px stub hanging below its bottom edge. The monotonic
    // rule still runs after the split, so the two slices keep the usual gap.
    expect(box(3)).toEqual({ top: 300, height: 48 });
    expect(box(4).top).toBe(348 + SEGMENT_GAP);
    expect(box(4).top + box(4).height).toBe(380);
    expect(box(4).height).toBeGreaterThan(MIN_SEGMENT_HEIGHT);
  });
});
