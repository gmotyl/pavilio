export type Period =
  | "today"
  | "this-week"
  | "last-week"
  | "this-month"
  | "last-month"
  | { from: string; to: string };

export type DateRange = { from: string; to: string };

const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

const toISODate = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const startOfISOWeek = (d: Date): Date => {
  const day = d.getDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (day + 6) % 7;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  monday.setDate(monday.getDate() - daysSinceMonday);
  return monday;
};

const addDays = (d: Date, n: number): Date => {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  copy.setDate(copy.getDate() + n);
  return copy;
};

const firstOfMonth = (year: number, month: number): Date => new Date(year, month, 1);

// `new Date(year, month, 0)` returns the last day of the previous month.
const lastOfMonth = (year: number, month: number): Date => new Date(year, month + 1, 0);

export function rangeForPeriod(period: Period, today: Date): DateRange {
  if (typeof period === "object") {
    return { from: period.from, to: period.to };
  }

  switch (period) {
    case "today": {
      const iso = toISODate(today);
      return { from: iso, to: iso };
    }
    case "this-week": {
      const monday = startOfISOWeek(today);
      const sunday = addDays(monday, 6);
      return { from: toISODate(monday), to: toISODate(sunday) };
    }
    case "last-week": {
      const thisMonday = startOfISOWeek(today);
      const lastMonday = addDays(thisMonday, -7);
      const lastSunday = addDays(lastMonday, 6);
      return { from: toISODate(lastMonday), to: toISODate(lastSunday) };
    }
    case "this-month": {
      const y = today.getFullYear();
      const m = today.getMonth();
      return { from: toISODate(firstOfMonth(y, m)), to: toISODate(lastOfMonth(y, m)) };
    }
    case "last-month": {
      const y = today.getFullYear();
      const m = today.getMonth();
      // previous month index (handles January wrap via Date arithmetic)
      const prev = new Date(y, m - 1, 1);
      const py = prev.getFullYear();
      const pm = prev.getMonth();
      return { from: toISODate(firstOfMonth(py, pm)), to: toISODate(lastOfMonth(py, pm)) };
    }
  }
}
