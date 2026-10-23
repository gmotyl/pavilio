const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** How many calendar months before the current one get a group of their own. */
const NAMED_MONTHS = 12;

function labelFor(date: Date, now: Date): string {
  // Weeks start on Monday (getDay: Sunday 0 … Saturday 6).
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  if (date >= weekStart) return "This week";
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  if (date >= monthStart) return "This month";
  const monthsAgo =
    now.getFullYear() * 12 + now.getMonth() - (date.getFullYear() * 12 + date.getMonth());
  if (monthsAgo <= NAMED_MONTHS) return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
  return String(date.getFullYear());
}

/**
 * Buckets archived rows by when they were archived, in local time: This week
 * (Monday start), This month, each of the previous 12 calendar months by name,
 * then one group per year. Groups and the rows inside them run newest first;
 * empty groups are never produced.
 */
export function groupArchived<T extends { archivedAt: string }>(
  rows: T[],
  now: Date,
): { label: string; rows: T[] }[] {
  const sorted = [...rows].sort(
    (a, b) => new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime(),
  );
  const groups: { label: string; rows: T[] }[] = [];
  for (const row of sorted) {
    const label = labelFor(new Date(row.archivedAt), now);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }
  return groups;
}
