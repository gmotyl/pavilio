import { useSyncExternalStore } from "react";

/**
 * A project's mark image on the server (`PUT|GET|DELETE /api/projects/:p/mark`).
 *
 * The `?v=<hash>` cache-buster lives here, in memory, and nowhere else: the
 * PUT answers with the content hash and this tab remembers it, so a replaced
 * image (same `image:mark.png` value, same URL) is fetched again instead of
 * served from the page's image cache. After a reload no hash is known and the
 * plain URL is used; the server answers it with `max-age=0` + ETag, so the
 * browser revalidates and still gets the current bytes. Keeping the hash out
 * of the preference keeps `project.mark` exactly `image:mark.<ext>`.
 */

export const MARK_IMAGE_MAX_BYTES = 256 * 1024;

const MARK_IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

const hashes = new Map<string, string>();
const listeners = new Set<() => void>();

function markUrl(project: string): string {
  return `/api/projects/${encodeURIComponent(project)}/mark`;
}

/** The `<img>` source for a project's stored mark image. */
export function markImageSrc(project: string, hash?: string): string {
  return hash ? `${markUrl(project)}?v=${encodeURIComponent(hash)}` : markUrl(project);
}

export function rememberMarkHash(project: string, hash: string): void {
  hashes.set(project, hash);
  for (const cb of listeners) cb();
}

export function useMarkHash(project: string): string | undefined {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => hashes.get(project),
    () => undefined,
  );
}

export function __resetMarkHashesForTests(): void {
  hashes.clear();
}

/** Why `file` cannot be a mark image, or null when it can. */
export function markImageProblem(file: File): string | null {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (!(ext in MARK_IMAGE_TYPES) || (file.type && file.type !== MARK_IMAGE_TYPES[ext])) {
    return "Use a PNG, SVG or WebP image";
  }
  if (file.size > MARK_IMAGE_MAX_BYTES) return "The image is larger than 256 KB";
  return null;
}

/** Store `file` as the project's mark image; resolves to the value to save in `project.mark`. */
export async function uploadMarkImage(project: string, file: File): Promise<string> {
  const body = new FormData();
  body.append("image", file);
  const res = await fetch(markUrl(project), { method: "PUT", body });
  const data = (await res.json().catch(() => ({}))) as { mark?: string; hash?: string; error?: string };
  if (!res.ok || !data.mark) throw new Error(data.error ?? `Upload failed (${res.status})`);
  if (data.hash) rememberMarkHash(project, data.hash);
  return data.mark;
}

/** Remove the project's mark image (idempotent on the server). */
export async function deleteMarkImage(project: string): Promise<void> {
  const res = await fetch(markUrl(project), { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`Delete failed (${res.status})`);
}
