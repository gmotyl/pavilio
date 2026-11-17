/**
 * Which sessions a menu's Close others / Close all hits, and the kill loop
 * that runs them. The strip is the surface's full session list — minimised
 * sessions included, since the tray belongs to the same strip.
 */
export type BulkCloseMode = "others" | "all";

export function bulkCloseTargets(
  strip: readonly { id: string }[],
  targetId: string,
  mode: BulkCloseMode,
): string[] {
  const ids = strip.map((s) => s.id);
  return mode === "all" ? ids : ids.filter((id) => id !== targetId);
}

/**
 * Kill each id in turn, never stopping at a failure. A kill fails when it
 * resolves `false` or throws; `void` counts as success (callers that cannot
 * report). Returns the ids that failed, in order.
 */
export async function killEach(
  ids: readonly string[],
  kill: (id: string) => Promise<boolean | void> | boolean | void,
): Promise<string[]> {
  const failed: string[] = [];
  for (const id of ids) {
    try {
      if ((await kill(id)) === false) failed.push(id);
    } catch {
      failed.push(id);
    }
  }
  return failed;
}
