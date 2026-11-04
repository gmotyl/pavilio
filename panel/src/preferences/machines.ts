// The two preferences routes behind Settings' "Copy preferences from <machine>"
// (design D4). They live here because `preferences/` is the only tree allowed to
// name the `/api/preferences` route (see no-direct-storage.test.ts) — neither
// reads nor writes a key behind the store's back: the copy replaces the whole
// server document, and the page reloads to read it once again (ADR-0015).

export interface PreferenceMachines {
  /** This machine's id. */
  self: string;
  /** The other machines with a committed preferences file. */
  machines: string[];
}

/** This machine's id and the other machines a copy may come from. Rejects when the server cannot say. */
export async function listPreferenceMachines(): Promise<PreferenceMachines> {
  const res = await fetch("/api/preferences/machines");
  if (!res.ok) throw new Error(`the server answered ${res.status}`);
  const body = (await res.json()) as Partial<PreferenceMachines>;
  return {
    self: typeof body.self === "string" ? body.self : "",
    machines: Array.isArray(body.machines) ? body.machines.filter((m) => typeof m === "string") : [],
  };
}

/**
 * Replace this machine's preferences with `machine`'s committed file, on the
 * server and on disk. The in-page document is NOT updated — reload the page.
 * Rejects with the server's reason when the copy did not happen.
 */
export async function copyPreferencesFrom(machine: string): Promise<void> {
  const res = await fetch("/api/preferences/copy-from", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ machine }),
  });
  if (res.ok) return;
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  throw new Error(typeof body.error === "string" ? body.error : `the server answered ${res.status}`);
}
