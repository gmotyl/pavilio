export interface WeightedEntry {
  sessionId: string;
  weight: number;
}

// One array per column.
export type ColumnLayout = WeightedEntry[][];

export interface LayoutPreset {
  label: string;
  sizes: number[];
}

// 3-column, column-major split with remainder going to the earliest columns.
// Used for the 7+ "Default" preset (mirrors the shipped defaultColumnSizes' 7+ branch).
function defaultThreeColumnSizes(count: number): number[] {
  const columns = 3;
  const base = Math.floor(count / columns);
  const remainder = count % columns;
  const sizes = [base, base, base];
  for (let i = 0; i < remainder; i++) sizes[i]++;
  return sizes;
}

// Even split of `count` across `columns` columns, remainder to earliest columns.
function evenSplit(count: number, columns: number): number[] {
  const base = Math.floor(count / columns);
  const remainder = count % columns;
  const sizes = new Array(columns).fill(base);
  for (let i = 0; i < remainder; i++) sizes[i]++;
  return sizes;
}

// The preset table from the design doc. Counts 1, 2 return a single [1]/[1,1] entry;
// 7+ returns [defaultColumnSizes-equivalent, "1 + rest split across 2 columns"].
// 3-6 return the Default/Alt1/Alt2 rows from the design's table.
export function getLayoutPresets(count: number): LayoutPreset[] {
  if (count <= 0) return [];
  if (count === 1) return [{ label: "Default", sizes: [1] }];
  if (count === 2) return [{ label: "Default", sizes: [1, 1] }];
  if (count === 3) {
    return [
      { label: "Default", sizes: [1, 2] },
      { label: "Alt 1", sizes: [1, 1, 1] },
    ];
  }
  if (count === 4) {
    return [
      { label: "Default", sizes: [2, 2] },
      { label: "Alt 1", sizes: [1, 3] },
      { label: "Alt 2", sizes: [1, 1, 2] },
    ];
  }
  if (count === 5) {
    return [
      { label: "Default", sizes: [2, 3] },
      { label: "Alt 1", sizes: [1, 4] },
      { label: "Alt 2", sizes: [1, 1, 3] },
    ];
  }
  if (count === 6) {
    return [
      { label: "Default", sizes: [2, 2, 2] },
      { label: "Alt 1", sizes: [1, 5] },
      { label: "Alt 2", sizes: [1, 1, 4] },
    ];
  }
  return [
    { label: "Default", sizes: defaultThreeColumnSizes(count) },
    { label: "Alt 1", sizes: [1, ...evenSplit(count - 1, 2)] },
  ];
}

// Expands a preset's plain sizes against `order` into weight-1 entries, consumed in order.
// Equivalent to the shipped columnsFromSizes, but produces {sessionId, weight:1} per slot.
export function expandPreset(order: string[], sizes: number[]): ColumnLayout {
  const columns: ColumnLayout = [];
  let idx = 0;
  for (const size of sizes) {
    columns.push(order.slice(idx, idx + size).map((sessionId) => ({ sessionId, weight: 1 })));
    idx += size;
  }
  return columns;
}

// Reconciles a stored layout against a fresh session order (closed-session removal +
// new-session growth), mirroring the shipped mergeColumnSizes:
// - ids in prevOrder absent from nextOrder: remove their entry; drop the column if emptied
//   (weights of untouched entries in that column are unaffected).
// - ids in nextOrder absent from prevOrder: append a weight-1 entry to the LAST column.
// - if prevLayout is empty, or every column empties, return [] (caller applies a default preset).
export function reconcileLayout(
  prevOrder: string[],
  prevLayout: ColumnLayout,
  nextOrder: string[],
): ColumnLayout {
  if (prevLayout.length === 0) return prevLayout;

  const nextSet = new Set(nextOrder);
  const columns: ColumnLayout = prevLayout
    .map((column) => column.filter((entry) => nextSet.has(entry.sessionId)))
    .filter((column) => column.length > 0);

  if (columns.length === 0) return [];

  const prevSet = new Set(prevOrder);
  const added = nextOrder.filter((id) => !prevSet.has(id));
  if (added.length > 0) {
    columns[columns.length - 1] = [
      ...columns[columns.length - 1],
      ...added.map((sessionId) => ({ sessionId, weight: 1 })),
    ];
  }

  return columns;
}

// Locates a sessionId's current column/entry index, or null if not present.
function locate(
  layout: ColumnLayout,
  sessionId: string,
): { column: number; index: number } | null {
  for (let column = 0; column < layout.length; column++) {
    const index = layout[column].findIndex((entry) => entry.sessionId === sessionId);
    if (index !== -1) return { column, index };
  }
  return null;
}

// Same-column merge only. No-op (same reference) if sessionId/targetId are in different
// columns, or either is missing. Removes sessionId's entry; targetId's entry becomes
// {sessionId, weight: targetWeight + sessionWeight} (dragged session takes the grown slot);
// appends a new column [{targetId, weight: 1}] (the displaced session).
export function mergeInColumn(
  layout: ColumnLayout,
  sessionId: string,
  targetId: string,
): ColumnLayout {
  const source = locate(layout, sessionId);
  const target = locate(layout, targetId);
  if (!source || !target || source.column !== target.column) return layout;

  const sessionWeight = layout[source.column][source.index].weight;
  const targetWeight = layout[target.column][target.index].weight;

  const nextColumns = layout.map((column) => column.slice());
  const column = nextColumns[source.column];
  column[target.index] = { sessionId, weight: targetWeight + sessionWeight };
  nextColumns[source.column] = column.filter((_entry, idx) => idx !== source.index);

  nextColumns.push([{ sessionId: targetId, weight: 1 }]);

  return nextColumns;
}

// Cross-column join only (unchanged semantics from the shipped joinColumn). No-op if
// sessionId/targetId share a column, or either is missing. Removes sessionId's entry
// (dropping its column if emptied); appends {sessionId, weight: 1} to targetId's column.
export function joinOtherColumn(
  layout: ColumnLayout,
  sessionId: string,
  targetId: string,
): ColumnLayout {
  const source = locate(layout, sessionId);
  const target = locate(layout, targetId);
  if (!source || !target || source.column === target.column) return layout;

  let nextColumns = layout.map((column) => column.slice());
  nextColumns[source.column] = nextColumns[source.column].filter(
    (entry) => entry.sessionId !== sessionId,
  );
  if (nextColumns[source.column].length === 0) {
    nextColumns = nextColumns.filter((_, idx) => idx !== source.column);
  }

  const targetColumnIndex = nextColumns.findIndex((column) =>
    column.some((entry) => entry.sessionId === targetId),
  );
  nextColumns[targetColumnIndex] = [
    ...nextColumns[targetColumnIndex],
    { sessionId, weight: 1 },
  ];

  return nextColumns;
}

// Unchanged semantics from the shipped splitToColumn, operating on the new shape. Removes
// sessionId's entry (dropping its column if emptied, shifting gutterIndex down if it pointed
// past the dropped column); inserts a new column [{sessionId, weight: 1}] at gutterIndex.
export function splitToNewColumn(
  layout: ColumnLayout,
  sessionId: string,
  gutterIndex: number,
): ColumnLayout {
  const source = locate(layout, sessionId);
  if (!source) return layout;

  let nextColumns = layout.map((column) => column.slice());
  nextColumns[source.column] = nextColumns[source.column].filter(
    (entry) => entry.sessionId !== sessionId,
  );

  let targetGutter = gutterIndex;
  if (nextColumns[source.column].length === 0) {
    nextColumns = nextColumns.filter((_, idx) => idx !== source.column);
    if (source.column < targetGutter) targetGutter--;
  }

  nextColumns.splice(targetGutter, 0, [{ sessionId, weight: 1 }]);

  return nextColumns;
}

// Exchanges which sessionId occupies each of sessionId's and targetId's current slots,
// weights untouched. No-op (same reference) if either is missing.
export function swapInLayout(
  layout: ColumnLayout,
  sessionId: string,
  targetId: string,
): ColumnLayout {
  const source = locate(layout, sessionId);
  const target = locate(layout, targetId);
  if (!source || !target) return layout;

  const nextColumns = layout.map((column) => column.slice());
  const sourceEntry = nextColumns[source.column][source.index];
  const targetEntry = nextColumns[target.column][target.index];
  nextColumns[source.column][source.index] = { ...sourceEntry, sessionId: targetId };
  nextColumns[target.column][target.index] = { ...targetEntry, sessionId: sessionId };

  return nextColumns;
}
