/**
 * The order Starred (and Home's Favourites) show: names in the saved
 * `shell.starredOrder` first, then starred names it does not mention in their
 * current order. Saved names that are no longer starred are ignored.
 */
export function orderStarred(
  saved: readonly string[],
  starred: readonly string[],
): string[] {
  const present = new Set(starred);
  // `saved` comes from storage: tolerate anything that is not a string list.
  const names = Array.isArray(saved) ? saved.filter((n): n is string => typeof n === "string") : [];
  const head = [...new Set(names)].filter((n) => present.has(n));
  const seen = new Set(head);
  return [...head, ...starred.filter((n) => !seen.has(n))];
}
