import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { mountStaticFrontend } from "./lib/static-frontend.js";
import { startPanel } from "./panel-server.js";

// Resolved against this module, not the cwd — the panel gets started from the
// repo root as often as from panel/.
const DIST_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");

startPanel((app) => {
  mountStaticFrontend(app, DIST_DIR);
}).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
