/**
 * The panel's **synthesis window**: one bound on how many speculative
 * syntheses are in flight at once, shared by every reason the panel has to
 * synthesize ahead of the ear.
 *
 * There are three such reasons, and they used to be counted separately — the
 * player's cascade had its own three slots, the host's unit-0 warms their own
 * two — so an armed grid could put five sockets against the audio somebody is
 * listening to, and a whole-utterance preload would have added a third pool on
 * top. One window, ranked:
 *
 * 1. **run** — the playing run's remainder (the player's cascade). Audio the
 *    listener is on.
 * 2. **warm** — unit 0 of an arriving utterance, so a lit control speaks on the
 *    click.
 * 3. **preload** — every further unit of an armed cell's unheard utterance, in
 *    arrival order.
 *
 * A freed slot always goes to the highest tier with work waiting, so a preload
 * can never take a slot the playing run wants; at worst the run waits for one
 * preload already in flight to land.
 *
 * What the window does NOT cover: the unit the listener is blocked on right
 * now (the player's ladder). That one is never queued behind anything — it
 * dedupes onto whatever the cache already has in flight for it.
 *
 * A plain object rather than a hook so the decision is testable without React;
 * the host creates one per panel and hands it to the player, which is what makes
 * it panel-wide.
 */

export type SynthesisTier = "run" | "warm" | "preload";

/** How many syntheses the window lets out at once, every tier together. */
export const SYNTHESIS_WINDOW_SIZE = 3;

/**
 * How many of those the speculative tiers (`warm` + `preload`) may hold.
 *
 * Two, so speculation never outnumbers the run and one slot is always free for
 * it the moment it starts: a click on a cell that is not the one being preloaded
 * gets its cascade going without waiting on anything. It is also the bound the
 * unit-0 warms had on their own before the window existed, so one cell's pair
 * (what is under the cursor, and what `next` reaches) still goes out together.
 */
export const SPECULATIVE_SLOTS = 2;

export type TierCounts = Readonly<Record<SynthesisTier, number>>;

/**
 * Which tier the next free slot goes to, or `null` when none may start.
 *
 * Pure on purpose: it is the whole priority rule, and it is the part worth
 * pinning without a synthesizer in the room.
 */
export function nextSlot(active: TierCounts, waiting: TierCounts): SynthesisTier | null {
  if (active.run + active.warm + active.preload >= SYNTHESIS_WINDOW_SIZE) return null;
  if (waiting.run > 0) return "run";
  if (active.warm + active.preload >= SPECULATIVE_SLOTS) return null;
  if (waiting.warm > 0) return "warm";
  if (waiting.preload > 0) return "preload";
  return null;
}

/**
 * A unit of work for the window. It is asked to start only when it has a slot,
 * and may decline by returning `null` — a preload whose cell was disarmed while
 * it waited, a cascade unit whose run was barged in — which hands the slot
 * straight to the next job rather than holding it for nothing.
 *
 * The returned promise's settling, either way, is what frees the slot: a
 * failed synthesis is not one that is still running.
 */
export type SynthesisJob = () => Promise<unknown> | null;

export interface SynthesisWindow {
  /** Starts the job now if its tier has a slot, otherwise queues it (FIFO per tier). */
  schedule(tier: SynthesisTier, job: SynthesisJob): void;
  /**
   * Closes the window: nothing scheduled afterwards is accepted, and every job
   * still queued is dropped unstarted the next time a slot frees. What is
   * already in flight is not cancelled — a synthesis cannot be — but nothing
   * new starts once the host that owns the window has unmounted.
   */
  dispose(): void;
  /**
   * Undoes {@link dispose}. Only for React's development double-mount, which
   * runs the host's unmount cleanup and then mounts the SAME instance again:
   * without this, a StrictMode panel would be left with a dead window.
   */
  reopen(): void;
}

export function createSynthesisWindow(): SynthesisWindow {
  const active: Record<SynthesisTier, number> = { run: 0, warm: 0, preload: 0 };
  const waiting: Record<SynthesisTier, SynthesisJob[]> = {
    run: [],
    warm: [],
    preload: [],
  };
  let disposed = false;

  const pump = (): void => {
    if (disposed) {
      // Dropped here rather than in `dispose`, so a dispose that is undone
      // before any slot frees (the development double-mount) loses nothing.
      waiting.run.length = 0;
      waiting.warm.length = 0;
      waiting.preload.length = 0;
      return;
    }
    for (;;) {
      const tier = nextSlot(active, {
        run: waiting.run.length,
        warm: waiting.warm.length,
        preload: waiting.preload.length,
      });
      if (tier === null) return;

      const job = waiting[tier].shift();
      if (!job) return;
      // Counted before the job runs, so a job that schedules more work while
      // starting cannot overfill the window through a nested pump.
      active[tier] += 1;
      const pending = job();
      if (!pending) {
        active[tier] -= 1;
        continue;
      }

      const release = (): void => {
        active[tier] -= 1;
        pump();
      };
      void pending.then(release, release);
    }
  };

  return {
    schedule(tier, job) {
      if (disposed) return;
      waiting[tier].push(job);
      pump();
    },
    dispose() {
      disposed = true;
    },
    reopen() {
      disposed = false;
      pump();
    },
  };
}
