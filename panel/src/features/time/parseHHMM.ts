/**
 * Parses a duration input string into total minutes.
 *
 * Accepts:
 *   - "HH:MM" form, e.g. "1:30" → 90, "0:45" → 45
 *   - Bare non-negative integer = minutes, e.g. "90" → 90
 *
 * Returns null for any invalid input. Whitespace is trimmed.
 */
export const parseHHMM = (input: string): number | null => {
  const trimmed = input.trim();
  if (trimmed === "") return null;

  if (trimmed.includes(":")) {
    // Must be exactly one colon -> HH:MM
    const parts = trimmed.split(":");
    if (parts.length !== 2) return null;
    const [hStr, mStr] = parts;
    if (hStr === "" || mStr === "") return null;
    if (!/^\d+$/.test(hStr) || !/^\d+$/.test(mStr)) return null;
    const h = Number(hStr);
    const m = Number(mStr);
    if (m >= 60) return null;
    return h * 60 + m;
  }

  // Bare integer form
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
};
