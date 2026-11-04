import os from "node:os";
import { getConfig } from "../config.js";

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

/** Panel config `machineId` (sanitized) when set, else machineHostname(). */
export function machineId(): string {
  const override = getConfig().machineId;
  if (typeof override === "string" && override.trim() !== "") return sanitizeHostname(override);
  return machineHostname();
}
