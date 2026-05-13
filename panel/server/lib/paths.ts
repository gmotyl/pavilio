import { homedir } from "os";
import { join } from "path";

/** Expand a leading `~` or `~/` to the user's home directory. */
export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}
