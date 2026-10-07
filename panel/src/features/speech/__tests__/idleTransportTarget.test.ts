import { describe, expect, it } from "vitest";
import { idleTransportTarget } from "../idleTransportTarget";

/** An `oldestUnheardArrival` reading from a plain record. */
const unheard =
  (arrivals: Record<string, number>) =>
  (sessionId: string): number | null =>
    arrivals[sessionId] ?? null;

describe("idleTransportTarget", () => {
  it("idle target is the autoplay cell with the oldest unheard answer", () => {
    expect(
      idleTransportTarget({
        // B is listed first, so "the first autoplay cell" would pick it.
        autoplaySessionIds: ["cell-b", "cell-a", "cell-c"],
        oldestUnheardArrival: unheard({ "cell-a": 100, "cell-b": 200 }),
        lastSpokenSessionId: "cell-c",
      }),
    ).toBe("cell-a");

    // A tie keeps the channel's order.
    expect(
      idleTransportTarget({
        autoplaySessionIds: ["cell-b", "cell-a"],
        oldestUnheardArrival: unheard({ "cell-a": 100, "cell-b": 100 }),
        lastSpokenSessionId: null,
      }),
    ).toBe("cell-b");

    // A cell that is not in autoplay is not a candidate, however old its answer.
    expect(
      idleTransportTarget({
        autoplaySessionIds: ["cell-b"],
        oldestUnheardArrival: unheard({ "cell-a": 1, "cell-b": 200 }),
        lastSpokenSessionId: null,
      }),
    ).toBe("cell-b");
  });

  it("idle target falls back to the last speaker", () => {
    expect(
      idleTransportTarget({
        autoplaySessionIds: ["cell-a", "cell-b"],
        oldestUnheardArrival: unheard({}),
        lastSpokenSessionId: "cell-c",
      }),
    ).toBe("cell-c");
  });

  it("idle target is null when nothing qualifies", () => {
    expect(
      idleTransportTarget({
        autoplaySessionIds: ["cell-a"],
        oldestUnheardArrival: unheard({}),
        lastSpokenSessionId: null,
      }),
    ).toBeNull();
    expect(
      idleTransportTarget({
        autoplaySessionIds: [],
        oldestUnheardArrival: unheard({ "cell-a": 1 }),
        lastSpokenSessionId: null,
      }),
    ).toBeNull();
  });
});
