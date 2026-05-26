/**
 * Formats a minute count for display.
 *
 *   <= 0 → ""  (so callers can decide whether to show a label fallback)
 *   <60  → "Nm"
 *   ==N*60 → "Nh"
 *   else → "Nh Mm"
 */
export function formatMinutes(n: number): string {
  if (n <= 0) return "";
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
