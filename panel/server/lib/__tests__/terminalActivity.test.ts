import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  recordOutput,
  recordInput,
  dismiss,
  getState,
  getAllStates,
  subscribe,
  _resetForTests,
  BUSY_THRESHOLD_MS,
  IDLE_DEBOUNCE_MS,
} from "../terminalActivity";

// Simulate a session that stays continuously busy for `durationMs` by
// emitting output in chunks smaller than the idle debounce window. This
// matches how a real long-running command keeps the state machine in
// "busy" until it finally goes quiet.
function stayBusyFor(sessionId: string, durationMs: number): void {
  const chunk = IDLE_DEBOUNCE_MS / 2;
  let elapsed = 0;
  while (elapsed < durationMs) {
    const step = Math.min(chunk, durationMs - elapsed);
    vi.advanceTimersByTime(step);
    recordOutput(sessionId);
    elapsed += step;
  }
}

describe("terminalActivity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetForTests();
  });

  it("starts sessions as idle", () => {
    expect(getState("s1")).toBe("idle");
  });

  it("goes busy on output and back to idle after quick silence", () => {
    recordOutput("s1");
    expect(getState("s1")).toBe("busy");
    vi.advanceTimersByTime(IDLE_DEBOUNCE_MS);
    expect(getState("s1")).toBe("idle");
  });

  it("goes to attention when busy longer than threshold then silent", () => {
    recordOutput("s1");
    stayBusyFor("s1", BUSY_THRESHOLD_MS + 100);
    vi.advanceTimersByTime(IDLE_DEBOUNCE_MS);
    expect(getState("s1")).toBe("attention");
  });

  it("does NOT go to attention for two short, unrelated bursts separated by idle", () => {
    // First short burst
    recordOutput("s1");
    vi.advanceTimersByTime(IDLE_DEBOUNCE_MS);
    expect(getState("s1")).toBe("idle");
    // Much later, another short burst
    vi.advanceTimersByTime(60_000);
    recordOutput("s1");
    vi.advanceTimersByTime(IDLE_DEBOUNCE_MS);
    expect(getState("s1")).toBe("idle");
  });

  it("dismiss clears attention to idle", () => {
    recordOutput("s1");
    stayBusyFor("s1", BUSY_THRESHOLD_MS + 100);
    vi.advanceTimersByTime(IDLE_DEBOUNCE_MS);
    expect(getState("s1")).toBe("attention");
    dismiss("s1");
    expect(getState("s1")).toBe("idle");
  });

  it("input clears attention to idle", () => {
    recordOutput("s1");
    stayBusyFor("s1", BUSY_THRESHOLD_MS + 100);
    vi.advanceTimersByTime(IDLE_DEBOUNCE_MS);
    expect(getState("s1")).toBe("attention");
    recordInput("s1");
    expect(getState("s1")).toBe("idle");
  });

  it("notifies subscribers on every state change", () => {
    const seen: { id: string; state: string }[] = [];
    subscribe((ev) => seen.push({ id: ev.sessionId, state: ev.state }));
    recordOutput("s1");
    vi.advanceTimersByTime(IDLE_DEBOUNCE_MS);
    expect(seen.map((x) => x.state)).toEqual(["busy", "idle"]);
  });

  it("getAllStates returns a snapshot of known sessions", () => {
    recordOutput("s1");
    recordOutput("s2");
    const snap = getAllStates();
    expect(snap.s1).toBe("busy");
    expect(snap.s2).toBe("busy");
  });

  it("a throwing listener does not prevent other listeners from receiving events", () => {
    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const seen: string[] = [];
    subscribe(() => {
      throw new Error("listener boom");
    });
    subscribe((ev) => seen.push(ev.state));
    recordOutput("s1");
    expect(seen).toEqual(["busy"]);
    errSpy.mockRestore();
  });

  it("async shell prompt output while in attention does not drop to idle", () => {
    // Repro: long command → attention (green) → shell prints async prompt
    // 0.5-2 s later → should stay attention, not drop to idle.
    recordOutput("s1");
    stayBusyFor("s1", BUSY_THRESHOLD_MS + 100);
    vi.advanceTimersByTime(IDLE_DEBOUNCE_MS);
    expect(getState("s1")).toBe("attention");
    // Async prompt fires after 800 ms
    vi.advanceTimersByTime(800);
    recordOutput("s1"); // e.g. powerlevel10k git status line
    vi.advanceTimersByTime(IDLE_DEBOUNCE_MS);
    expect(getState("s1")).toBe("attention"); // must NOT be "idle"
  });

  it("emits attentionSinceAt only when state is attention", () => {
    const seen: any[] = [];
    subscribe((ev) => seen.push(ev));
    recordOutput("s1");
    stayBusyFor("s1", BUSY_THRESHOLD_MS + 100);
    vi.advanceTimersByTime(IDLE_DEBOUNCE_MS);
    const attentionEv = seen.find((e) => e.state === "attention");
    const busyEv = seen.find((e) => e.state === "busy");
    expect(typeof attentionEv.attentionSinceAt).toBe("number");
    expect(busyEv.attentionSinceAt).toBeUndefined();
  });
  /**
   * The flap this file exists to name.
   *
   * `attention` is not "the agent stopped". It is "this session was busy for
   * longer than {@link BUSY_THRESHOLD_MS} and has now been quiet for
   * {@link IDLE_DEBOUNCE_MS}" — which for an agent that thinks between bursts
   * of output is simply the gap between two bursts. And once a session has
   * reached `attention`, `recordOutput` BACKDATES `busyStartedAt` past the
   * threshold on purpose (so an async shell prompt cannot silently clear the
   * LED), which means every later gap resolves to `attention` again and never
   * to `idle`.
   *
   * So a working agent does not sit in one state. It oscillates
   * busy → attention → busy → attention for the whole run, broadcasting each
   * flip, and only an input or a dismiss ever reaches `idle`. Any consumer that
   * reads "not busy" as "the agent let go" sees the agent let go every couple
   * of seconds. `answerWaiting` was that consumer; this test is the fact it is
   * now written against.
   */
  it("a long-running bursty agent oscillates busy<->attention and never reaches idle", () => {
    const seen: string[] = [];
    subscribe((ev) => seen.push(ev.state));

    // A long first run: the agent works for longer than the busy threshold.
    recordOutput("s1");
    stayBusyFor("s1", BUSY_THRESHOLD_MS + 100);

    // Then it thinks. Four bursts of output, each separated by a gap longer
    // than the idle debounce — the ordinary shape of an agent that emits a
    // tool call, pauses, emits a result, pauses.
    for (let i = 0; i < 4; i += 1) {
      vi.advanceTimersByTime(IDLE_DEBOUNCE_MS + 200);
      recordOutput("s1");
    }
    vi.advanceTimersByTime(IDLE_DEBOUNCE_MS + 200);

    expect(seen).toEqual([
      "busy",
      "attention",
      "busy",
      "attention",
      "busy",
      "attention",
      "busy",
      "attention",
      "busy",
      "attention",
    ]);
    // Not once: the agent is still working, and nothing here is an input.
    expect(seen).not.toContain("idle");
  });

  /**
   * The other half of the same fact: `attention` is a terminal state as far as
   * the agent is concerned. Nothing the AGENT does moves it to `idle` — only
   * the user typing ({@link recordInput}) or dismissing it does. So a consumer
   * that waits for `idle` before it stops treating the session as the agent's
   * is waiting for an event the agent will never send.
   */
  it("only a user gesture moves attention to idle", () => {
    recordOutput("s1");
    stayBusyFor("s1", BUSY_THRESHOLD_MS + 100);
    vi.advanceTimersByTime(IDLE_DEBOUNCE_MS);
    expect(getState("s1")).toBe("attention");

    // Ten more minutes of silence change nothing.
    vi.advanceTimersByTime(600_000);
    expect(getState("s1")).toBe("attention");

    recordInput("s1");
    expect(getState("s1")).toBe("idle");
  });
});
