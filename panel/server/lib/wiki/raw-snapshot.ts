import { lstatSync } from "fs";

/** Helpers shared by the commands that write raw snapshots into `wiki/raw/` (fetch-article, save-atlassian). */

/** Filesystem-safe, deterministic slug: ASCII, lowercase, dash-separated, ≤ 60 chars. */
export function slugify(text: string, limit = 60): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  if (slug.length <= limit) return slug;
  const cut = slug.slice(0, limit);
  const lastDash = cut.lastIndexOf("-");
  return lastDash > 0 ? cut.slice(0, lastDash) : cut;
}

/** A planted symlink in `raw/` must never redirect a write or a removal. */
export function refuseSymlink(file: string): void {
  if (lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error(`refusing a symlinked raw snapshot: ${file}`);
  }
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
