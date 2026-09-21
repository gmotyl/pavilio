// Flush pending preference writes before the process goes away.
//
// The preference store debounces its writes by a quarter second, so a toggle
// flipped immediately before Ctrl-C would otherwise never reach disk. The
// default action for every signal below is to terminate, and installing a
// handler replaces it — so each handler ends by exiting with the conventional
// 128 + signal number, the code a shell reports for a signalled process.

import { flushPreferences } from "./preferences-store.js";

/** Signal → its number, for the conventional 128 + n exit code. */
const SIGNALS = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 } as const;

let installed = false;

/**
 * Register the termination handlers. Idempotent: a second call is a no-op, so
 * an entry point that is imported twice does not stack duplicate listeners.
 */
export function installPreferenceFlush(): void {
  if (installed) return;
  installed = true;

  for (const [signal, number] of Object.entries(SIGNALS)) {
    process.once(signal as NodeJS.Signals, () => {
      void (async () => {
        // Never rejects — a failed write is logged by the store, and a full
        // disk must not be the reason a shutdown hangs.
        await flushPreferences();
        process.exit(128 + number);
      })();
    });
  }
}
