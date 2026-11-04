import { useEffect, useState } from "react";
import { AlertTriangle, Copy } from "lucide-react";
import {
  copyPreferencesFrom,
  listPreferenceMachines,
  type PreferenceMachines,
} from "../../preferences/machines";

/** `null` while the list is asked for, `"unavailable"` when the server could not say. */
type MachinesView = PreferenceMachines | "unavailable" | null;

/**
 * Settings → "Copy preferences from <machine>" (design D4).
 *
 * Every machine keeps its own preferences file; this lists the other machines
 * with a committed one and, after the browser's `confirm` (as the page-cache
 * wipe and the time reset do), replaces this machine's whole document with the
 * picked one (see preferences/machines.ts). Preferences are read once at boot
 * (ADR-0015), so the page then reloads to pick the copied values up. Cancelling
 * the confirmation sends nothing.
 *
 * `reload` is the page reload, injectable for tests.
 */
export function CopyPreferencesSection({ reload = () => window.location.reload() }: { reload?: () => void }) {
  const [view, setView] = useState<MachinesView>(null);
  const [copying, setCopying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const listed = await listPreferenceMachines();
        if (live) setView(listed);
      } catch {
        if (live) setView("unavailable");
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const copyFrom = async (machine: string): Promise<void> => {
    if (
      !window.confirm(
        `Replace this machine's preferences with ${machine}'s? Every preference set here is overwritten, and the page reloads.`,
      )
    ) {
      return;
    }
    setCopying(machine);
    setError(null);
    try {
      await copyPreferencesFrom(machine);
      reload();
    } catch (err) {
      setError(`Couldn't copy ${machine}'s preferences: ${err instanceof Error ? err.message : String(err)}`);
      setCopying(null);
    }
  };

  return (
    <div data-testid="copy-preferences">
      <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        Copy preferences
      </h3>
      <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
        Each machine keeps its own preferences
        {view && view !== "unavailable" ? (
          <>
            {" "}
            (this one is <code>{view.self}</code>)
          </>
        ) : null}
        . Copying replaces all of this machine's preferences with another machine's committed ones.
      </p>
      <div className="mt-2 text-sm">
        {view === null && <span style={{ color: "var(--text-muted)" }}>Loading…</span>}
        {view === "unavailable" && (
          <span className="inline-flex items-center gap-1.5" style={{ color: "var(--red)" }}>
            <AlertTriangle size={12} />
            Could not list the other machines.
          </span>
        )}
        {view && view !== "unavailable" && view.machines.length === 0 && (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            No other machine has committed preferences yet.
          </span>
        )}
        {view && view !== "unavailable" && view.machines.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {view.machines.map((machine) => (
              <button
                key={machine}
                type="button"
                data-testid={`copy-preferences-${machine}`}
                onClick={() => void copyFrom(machine)}
                disabled={copying !== null}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: "var(--bg-surface)",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <Copy size={11} />
                Copy preferences from {machine}
              </button>
            ))}
          </div>
        )}
      </div>
      {error && (
        <div className="flex items-start gap-2 text-xs mt-2" style={{ color: "var(--red)" }}>
          <AlertTriangle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
          {error}
        </div>
      )}
    </div>
  );
}
