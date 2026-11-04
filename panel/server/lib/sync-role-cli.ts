// Entry point of scripts/sync-role: prints this machine's sync role on a ref
// (default origin/main) of a workspace repo (default the cwd), after loading
// panel.config.local.ts exactly as the panel server does, so the machine id
// matches machineId().
//
//   sync-role-cli.ts [--ref <ref>] [--repo <dir>]
import { loadConfig } from "../config.js";
import { machineId } from "./hostname.js";
import { resolveSyncRole } from "./syncRole.js";

function usage(message: string): never {
  process.stderr.write(`sync-role: ${message}\nusage: scripts/sync-role [--ref <ref>] [--repo <dir>]\n`);
  process.exit(2);
}

let ref = "origin/main";
let repo = process.cwd();
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  const value = args[i + 1];
  if (flag !== "--ref" && flag !== "--repo") usage(`unknown argument ${flag}`);
  if (value === undefined || value === "") usage(`${flag} needs a value`);
  if (flag === "--ref") ref = value;
  else repo = value;
  i++;
}

await loadConfig();
try {
  const role = await resolveSyncRole({ repo, ref, machineId: machineId() });
  process.stdout.write(`${role}\n`);
} catch (err) {
  process.stderr.write(`sync-role: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
