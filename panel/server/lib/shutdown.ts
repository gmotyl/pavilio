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
let crashLogInstalled = false;

/** How long a crashing panel waits for the preference flush before exiting anyway. */
const CRASH_FLUSH_TIMEOUT_MS = 1000;

/**
 * Log an uncaught exception or unhandled rejection with a timestamp, flush
 * preferences, and exit 1. Node already prints the stack and exits on its own;
 * what this adds is the time of death and a marker line in `.panel.log`, which
 * otherwise holds nothing to match a crash against agent transcripts or the
 * terminals' last activity. It deliberately does not keep the process alive:
 * after an uncaught exception its state is unknown.
 */
export function installCrashLog(): void {
  if (crashLogInstalled) return;
  crashLogInstalled = true;

  const die = (kind: string, err: unknown) => {
    console.error(`[panel] ${new Date().toISOString()} ${kind} — panel exiting:`, err);
    // A flush that hangs must not keep a broken process alive.
    setTimeout(() => process.exit(1), CRASH_FLUSH_TIMEOUT_MS).unref();
    void flushPreferences().then(() => process.exit(1));
  };
  process.on("uncaughtException", (err) => die("uncaught exception", err));
  process.on("unhandledRejection", (reason) => die("unhandled rejection", reason));
}

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
