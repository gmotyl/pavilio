function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** YYYY-MM-DD in local time (not UTC). */
export function localISODate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
