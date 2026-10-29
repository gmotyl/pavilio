import { useEffect, useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { alerts } from "../alerts/store";
import { formatBytes } from "./formatBytes";
import { cacheTotals, wipeCache, type PageCacheTotals } from "./pageCache";
import { useStopPageRuns } from "./SpeechHostProvider";

const ZERO: PageCacheTotals = { pages: 0, units: 0, bytes: 0 };

/** `null` while the totals are asked for, `"unavailable"` when the server could not say. */
type TotalsView = PageCacheTotals | "unavailable" | null;

function count(n: number, noun: string): string {
  return `${n.toLocaleString("en-US")} ${noun}${n === 1 ? "" : "s"}`;
}

/** "38 pages · 1,204 units · 46.3 MB" — the mockup's Stored row. */
function describeTotals(totals: PageCacheTotals): string {
  return `${count(totals.pages, "page")} · ${count(totals.units, "unit")} · ${formatBytes(totals.bytes)}`;
}

/**
 * Settings → Speech → "Page audio cache": what the page audio cache holds on
 * the panel server, and Wipe cache… to empty it.
 *
 * The totals are read once, when Settings opens; a failure reads "Cache
 * unavailable" and disables the wipe — there is no size to confirm.
 *
 * The wipe confirms first with the browser's `confirm`, naming the size, as
 * the time page's reset does. On confirm, whichever page is playing stops
 * BEFORE the wipe, so nothing its run plays or warms lands after it; then the
 * row reads zero. A failed wipe raises "Couldn't clear the cache: <reason>"
 * (the page bar's alert) and re-reads the totals, since `wipeCache` empties
 * memory either way but the disk may still hold some of it.
 */
export function PageCacheSettings() {
  const stopPageRuns = useStopPageRuns();
  const [totals, setTotals] = useState<TotalsView>(null);
  const [wiping, setWiping] = useState(false);

  const readTotals = async (): Promise<void> => {
    try {
      setTotals(await cacheTotals());
    } catch {
      setTotals("unavailable");
    }
  };

  useEffect(() => {
    let live = true;
    cacheTotals().then(
      (read) => live && setTotals(read),
      () => live && setTotals("unavailable"),
    );
    return () => {
      live = false;
    };
  }, []);

  const wipe = async (): Promise<void> => {
    if (totals === null || totals === "unavailable") return;
    if (!window.confirm(`Delete ${formatBytes(totals.bytes)} of cached page audio?`)) return;
    stopPageRuns();
    setWiping(true);
    try {
      await wipeCache();
      setTotals(ZERO);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      alerts.error(`Couldn't clear the cache: ${reason}`);
      await readTotals();
    } finally {
      setWiping(false);
    }
  };

  const unavailable = totals === "unavailable";

  return (
    <div data-testid="page-cache-settings">
      <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        Page audio cache
      </h3>
      <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
        Audio synthesized for markdown pages is kept in <code>~/.pavilio/speech-cache/</code> and
        replayed instead of being synthesized again. Agent answers are never cached here.
      </p>
      <div className="flex items-center gap-3 mt-2 text-sm">
        <span className="text-xs" style={{ color: "var(--text-muted)", minWidth: 56 }}>
          Stored
        </span>
        {unavailable ? (
          <span className="inline-flex items-center gap-1.5" style={{ color: "var(--red)" }}>
            <AlertTriangle size={12} />
            Cache unavailable
          </span>
        ) : (
          <span style={{ color: "var(--text-primary)" }}>
            {totals === null ? "Loading…" : describeTotals(totals)}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 mt-2">
        <span style={{ minWidth: 56 }} />
        <button
          type="button"
          data-testid="page-cache-wipe"
          onClick={() => void wipe()}
          disabled={totals === null || unavailable || wiping}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: "color-mix(in srgb, var(--red) 10%, transparent)",
            color: "var(--red)",
            border: "1px solid color-mix(in srgb, var(--red) 25%, transparent)",
          }}
        >
          <Trash2 size={12} />
          Wipe cache…
        </button>
      </div>
    </div>
  );
}
