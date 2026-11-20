export interface GroupChip {
  name: string;
  count: number;
}

/** "All" plus one chip per section; the pressed chip is the active filter. */
export function GroupChips({
  chips,
  total,
  selected,
  onSelect,
}: {
  chips: GroupChip[];
  total: number;
  /** `null` = All. */
  selected: string | null;
  onSelect: (name: string | null) => void;
}) {
  const all: { key: string | null; label: string; count: number }[] = [
    { key: null, label: "All", count: total },
    ...chips.map((c) => ({ key: c.name, label: c.name, count: c.count })),
  ];
  return (
    <div
      role="group"
      aria-label="Filter by group"
      className="flex flex-wrap gap-2 mb-4"
      data-testid="dashboard-group-chips"
    >
      {all.map((c) => {
        const pressed = c.key === selected;
        return (
          <button
            key={c.key ?? "__all"}
            type="button"
            aria-pressed={pressed}
            onClick={() => onSelect(c.key)}
            className="rounded-full px-3 py-1 text-[13px] border"
            style={{
              background: pressed ? "var(--accent)" : "var(--bg-hover)",
              borderColor: pressed ? "var(--accent)" : "var(--border-subtle)",
              color: pressed ? "var(--bg-base, #0b1020)" : "var(--text-primary)",
              fontWeight: pressed ? 600 : 400,
            }}
          >
            {c.label}
            <span className="ml-1 text-[12px]" style={{ opacity: 0.7 }}>
              {c.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
