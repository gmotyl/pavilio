/** Viewer copy for a file the server refused to read whole (413, or an untracked diff past its cap). */
export function tooLargeMessage(size: number | undefined): string {
  return size ? `This file is too large to display (${(size / 1024 / 1024).toFixed(1)} MB).` : "This file is too large to display.";
}

/** Byte size from a 413 `{ tooLarge, size }` body, or undefined when the response isn't one. */
export async function tooLargeSize(res: Response): Promise<number | undefined> {
  const body = (await res.json().catch(() => null)) as { size?: unknown } | null;
  return typeof body?.size === "number" ? body.size : undefined;
}
