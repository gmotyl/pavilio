import { describe, expect, it } from "vitest";
import { createAutoplayQueue, type QueuedAnswer } from "../autoplayQueue";

const always = (): boolean => true;

describe("autoplayQueue", () => {
  it("queue keeps arrival order and ignores duplicates", () => {
    const queue = createAutoplayQueue();
    queue.enqueue({ sessionId: "b", utteranceId: "b1" });
    queue.enqueue({ sessionId: "c", utteranceId: "c1" });
    // The same arrival seen twice — a re-render, a re-broadcast — is one turn.
    queue.enqueue({ sessionId: "b", utteranceId: "b1" });
    queue.enqueue({ sessionId: "b", utteranceId: "b2" });

    expect(queue.next(always)).toEqual({ sessionId: "b", utteranceId: "b1" });
    expect(queue.next(always)).toEqual({ sessionId: "c", utteranceId: "c1" });
    expect(queue.next(always)).toEqual({ sessionId: "b", utteranceId: "b2" });
    expect(queue.next(always)).toBeNull();
  });

  it("next drops heads that are no longer unheard", () => {
    const queue = createAutoplayQueue();
    queue.enqueue({ sessionId: "b", utteranceId: "b1" });
    queue.enqueue({ sessionId: "c", utteranceId: "c1" });
    queue.enqueue({ sessionId: "d", utteranceId: "d1" });

    const heard = new Set(["b1"]);
    const unheard = (entry: QueuedAnswer): boolean => !heard.has(entry.utteranceId);

    expect(queue.next(unheard)).toEqual({ sessionId: "c", utteranceId: "c1" });
    // The stale head is gone for good, not merely skipped this once.
    heard.clear();
    expect(queue.entries()).toEqual([{ sessionId: "d", utteranceId: "d1" }]);

    heard.add("d1");
    expect(queue.next(unheard)).toBeNull();
    expect(queue.entries()).toEqual([]);
  });

  it("dropSession removes every entry for that cell", () => {
    const queue = createAutoplayQueue();
    queue.enqueue({ sessionId: "b", utteranceId: "b1" });
    queue.enqueue({ sessionId: "c", utteranceId: "c1" });
    queue.enqueue({ sessionId: "b", utteranceId: "b2" });

    queue.dropSession("b");

    expect(queue.entries()).toEqual([{ sessionId: "c", utteranceId: "c1" }]);
    // A dropped utterance may be queued again: the guard is on what is queued.
    queue.enqueue({ sessionId: "b", utteranceId: "b1" });
    expect(queue.entries()).toHaveLength(2);
  });

  it("dropStale removes stale entries wherever they sit", () => {
    const queue = createAutoplayQueue();
    queue.enqueue({ sessionId: "b", utteranceId: "b1" });
    queue.enqueue({ sessionId: "c", utteranceId: "c1" });
    queue.enqueue({ sessionId: "d", utteranceId: "d1" });

    queue.dropStale((entry) => entry.utteranceId !== "c1");

    expect(queue.entries().map((entry) => entry.utteranceId)).toEqual(["b1", "d1"]);
  });

  it("a newer answer takes over its cell's superseded entry in place", () => {
    const queue = createAutoplayQueue();
    queue.enqueue({ sessionId: "a", utteranceId: "a1" });
    queue.enqueue({ sessionId: "b", utteranceId: "b1" });
    queue.enqueue({ sessionId: "c", utteranceId: "c1" });
    // b2 replaced b1 under B's cursor, so B no longer owes b1; A still owes a1.
    const owed = new Set(["a1", "c1", "b2"]);
    queue.enqueue({ sessionId: "b", utteranceId: "b2" }, (entry) => owed.has(entry.utteranceId));
    queue.enqueue({ sessionId: "a", utteranceId: "a2" }, (entry) => owed.has(entry.utteranceId));

    expect(queue.entries().map((entry) => entry.utteranceId)).toEqual(["a1", "b2", "c1", "a2"]);
  });
});
