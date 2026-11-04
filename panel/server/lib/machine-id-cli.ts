// Entry point of scripts/machine-id: prints this machine's id (machineId()) and
// one trailing newline, after loading panel.config.local.ts exactly as the
// panel server does, so bash callers and the server always agree.
import { loadConfig } from "../config.js";
import { machineId } from "./hostname.js";

await loadConfig();
process.stdout.write(`${machineId()}\n`);
