import os from "node:os";

/**
 * Machine naming without a config dependency. `hostname.ts#machineId()` reads the
 * loaded panel config; these helpers are what `panel.config.ts` and `config.ts`
 * use while the config itself is still being built.
 */

export function sanitizeHostname(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "unknown";
}

export function machineHostname(): string {
  return sanitizeHostname(os.hostname());
}

/** The sanitized `override` when it is a non-blank string, else machineHostname(). */
export function machineIdFrom(override: unknown): string {
  if (typeof override === "string" && override.trim() !== "") return sanitizeHostname(override);
  return machineHostname();
}
