import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import {
  MissingFrontendBundleError,
  mountStaticFrontend,
} from "./lib/static-frontend.js";
import { PortUnavailableError, startPanel } from "./panel-server.js";
import { installPreferenceFlush } from "./lib/shutdown.js";

// Resolved against this module, not the cwd — the panel gets started from the
// repo root as often as from panel/.
const DIST_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");

// Before startPanel, not after: the store debounces writes by 250 ms, and a
// panel killed during startup should still commit whatever it had.
installPreferenceFlush();

startPanel((app) => {
  mountStaticFrontend(app, DIST_DIR);
}).catch((err: unknown) => {
  // A missing bundle, or a PANEL_PORT somebody else is holding, is an
  // instruction to the user and its stack tells them nothing — print the
  // message alone. Anything else (an unparseable config, an unreadable TLS
  // file, no free port in the whole span) is a real fault: print the whole
  // error, stack included, or the failure is undiagnosable.
  if (err instanceof MissingFrontendBundleError || err instanceof PortUnavailableError) {
    console.error(err.message);
  } else {
    console.error(err);
  }
  process.exit(1);
});
