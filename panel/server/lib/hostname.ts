import os from "node:os";

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
