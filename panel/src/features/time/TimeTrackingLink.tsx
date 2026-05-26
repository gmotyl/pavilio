import { Link } from "react-router-dom";
import { formatMinutes } from "./formatMinutes";

/**
 * Always-visible navigation link to a project's Time tracking page.
 *
 * Renders "⌛ Time tracking" when minutes <= 0, otherwise "⌛ Time · <hms>".
 * Replaces the previous TimeBadge which hid itself when minutes <= 0.
 */
export function TimeTrackingLink({
  minutes,
  to,
}: {
  minutes: number;
  to: string;
}) {
  const label =
    minutes > 0 ? `⌛ Time · ${formatMinutes(minutes)}` : "⌛ Time tracking";
  return (
    <Link
      to={to}
      title="Open Time tracking. Auto-tracked from terminal activity."
      className="ml-3 text-xs hover:underline"
      style={{ color: "var(--text-tertiary)" }}
    >
      {label}
    </Link>
  );
}
