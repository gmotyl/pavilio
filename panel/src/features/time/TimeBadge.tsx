import { Link } from "react-router-dom";

export function formatMinutes(n: number): string {
  if (n <= 0) return "";
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function TimeBadge({
  minutes,
  to,
}: {
  minutes: number;
  to: string;
}) {
  if (minutes <= 0) return null;
  return (
    <Link
      to={to}
      title="Auto-tracked from terminal activity. Click to open Time tab."
      className="ml-3 text-xs"
      style={{ color: "var(--text-tertiary)" }}
    >
      ⌛ {formatMinutes(minutes)}
    </Link>
  );
}
