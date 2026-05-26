import { describe, it, expect } from "vitest";
import {
  reduce,
  displayMinutes,
  AccumulatorState,
  busyEvent,
  tick,
} from "../busyAccumulator";

const t = (hhmm: string) => new Date(`2026-05-25T${hhmm}:00+00:00`).getTime();
const initial = (): AccumulatorState => ({
  date: "2026-05-25",
  closedMinutes: 0,
  open: null,
});

describe("busyAccumulator — Greg ex1 (single 15m)", () => {
  it("12:01 busy → 12:05 done → 12:30 idle → display stays at 15", () => {
    let s = initial();
    s = reduce(s, busyEvent(t("12:01")));
    expect(displayMinutes(s, t("12:01"))).toBe(15);
    s = reduce(s, tick(t("12:30")));
    expect(displayMinutes(s, t("12:30"))).toBe(15);
  });
});

describe("busyAccumulator — Greg ex2 (15+15+15 across breaks)", () => {
  it("yields 45 after all three busy blocks close", () => {
    let s = initial();
    s = reduce(s, busyEvent(t("12:01"))); // slot 1 starts
    s = reduce(s, tick(t("12:16")));      // closes 15
    s = reduce(s, busyEvent(t("13:02"))); // slot 2
    s = reduce(s, tick(t("13:17")));      // closes 15
    s = reduce(s, busyEvent(t("13:20"))); // slot 3
    s = reduce(s, tick(t("13:35")));      // closes 15
    expect(displayMinutes(s, t("13:35"))).toBe(45);
  });
});

describe("busyAccumulator — within-window extension", () => {
  it("12:01 + 12:10 busy → 15 → 15 → 30 at 12:16 → 30 at close", () => {
    let s = initial();
    s = reduce(s, busyEvent(t("12:01")));
    expect(displayMinutes(s, t("12:01"))).toBe(15);
    s = reduce(s, busyEvent(t("12:10")));
    expect(displayMinutes(s, t("12:10"))).toBe(15);
    expect(displayMinutes(s, t("12:16"))).toBe(30);
    s = reduce(s, tick(t("12:25")));
    expect(displayMinutes(s, t("12:25"))).toBe(30);
  });
});

describe("busyAccumulator — midnight rollover", () => {
  it("force-closes open block and resets closed counter", () => {
    let s = initial();
    s = reduce(s, busyEvent(t("23:50")));
    s = reduce(s, {
      type: "rollover",
      at: new Date("2026-05-26T00:00:00+00:00").getTime(),
      newDate: "2026-05-26",
    });
    expect(s.date).toBe("2026-05-26");
    expect(s.closedMinutes).toBe(0);
    expect(s.open).toBeNull();
  });
});
