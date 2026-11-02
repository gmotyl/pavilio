import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { listEngines } from "anytts";

/** One month of speech usage, summed across hosts by the server. */
interface UsageMonth {
  month: string;
  engines: Record<string, number>;
  total: number;
}

type UsageState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; months: UsageMonth[] };

/** The card shows at most this many months (design.md § Settings card). */
const MAX_MONTHS = 6;

const MUTED: CSSProperties = { color: "var(--text-muted)" };
const CELL_CLASS = "text-xs px-2 py-1";
const CELL_STYLE: CSSProperties = {
  borderBottom: "1px solid var(--border-subtle)",
  whiteSpace: "nowrap",
};

function isUsageMonth(value: unknown): value is UsageMonth {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<UsageMonth>;
  return typeof v.month === "string" && typeof v.total === "number" && typeof v.engines === "object" && v.engines !== null;
}

async function loadUsage(): Promise<UsageMonth[]> {
  const res = await fetch("/api/speech/usage");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { months?: unknown };
  if (!Array.isArray(body?.months) || !body.months.every(isUsageMonth)) {
    throw new Error("Malformed usage response");
  }
  return body.months;
}

/**
 * Settings → Speech → *Speech usage*: characters sent to speech engines per
 * month (newest first), one column per engine with any usage in the shown
 * months, plus the month's total. Read once on mount from
 * `GET /api/speech/usage`, which sums every host's usage file.
 */
export function SpeechUsageCard() {
  const [state, setState] = useState<UsageState>({ kind: "loading" });
  const labels = useMemo(() => new Map(listEngines().map((engine) => [engine.id, engine.label])), []);
  const format = useMemo(() => new Intl.NumberFormat(), []);

  useEffect(() => {
    let alive = true;
    loadUsage().then(
      (months) => alive && setState({ kind: "ready", months: months.slice(0, MAX_MONTHS) }),
      () => alive && setState({ kind: "error" }),
    );
    return () => {
      alive = false;
    };
  }, []);

  const months = state.kind === "ready" ? state.months : [];
  // Column order follows first appearance, newest month first.
  const engines: string[] = [];
  for (const month of months) {
    for (const [engine, chars] of Object.entries(month.engines)) {
      if (chars > 0 && !engines.includes(engine)) engines.push(engine);
    }
  }

  return (
    <div data-testid="speech-usage" style={{ minWidth: 0 }}>
      <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        Speech usage
      </h3>
      <p className="text-xs mt-1" style={MUTED}>
        Characters sent to speech engines per month, summed across every host that syncs this
        workspace.
      </p>
      {state.kind === "loading" && (
        <p className="text-xs mt-3" style={MUTED}>
          Loading…
        </p>
      )}
      {state.kind === "error" && (
        <p role="alert" data-testid="speech-usage-error" className="text-xs mt-3" style={{ color: "var(--red)" }}>
          Could not load speech usage from the panel server.
        </p>
      )}
      {state.kind === "ready" && months.length === 0 && (
        <p className="text-xs mt-3" style={MUTED}>
          No speech usage yet
        </p>
      )}
      {state.kind === "ready" && months.length > 0 && (
        <div className="mt-3" style={{ overflowX: "auto", minWidth: 0 }}>
          <table className="text-xs" style={{ borderCollapse: "collapse", color: "var(--text-primary)" }}>
            <thead>
              <tr>
                <th className={`${CELL_CLASS} text-left font-semibold`} style={{ ...CELL_STYLE, ...MUTED }}>
                  Month
                </th>
                {engines.map((engine) => (
                  <th key={engine} className={`${CELL_CLASS} text-right font-semibold`} style={{ ...CELL_STYLE, ...MUTED }}>
                    {labels.get(engine) ?? engine}
                  </th>
                ))}
                <th className={`${CELL_CLASS} text-right font-semibold`} style={{ ...CELL_STYLE, ...MUTED }}>
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {months.map((month) => (
                <tr key={month.month}>
                  <td className={`${CELL_CLASS} text-left`} style={CELL_STYLE}>
                    {month.month}
                  </td>
                  {engines.map((engine) => (
                    <td key={engine} className={`${CELL_CLASS} text-right`} style={{ ...CELL_STYLE, fontVariantNumeric: "tabular-nums" }}>
                      {format.format(month.engines[engine] ?? 0)}
                    </td>
                  ))}
                  <td className={`${CELL_CLASS} text-right font-semibold`} style={{ ...CELL_STYLE, fontVariantNumeric: "tabular-nums" }}>
                    {format.format(month.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
