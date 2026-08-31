export type ColumnSizes = number[];

// count=0->[]; 1->[1]; 2->[1,1]; 3->[1,2]; 4->[2,2]; 5->[2,3]; 6->[2,2,2];
// 7+ -> 3 columns, column-major, remainder to earliest columns (7->[3,2,2], 8->[3,3,2]).
export function defaultColumnSizes(count: number): ColumnSizes {
  if (count <= 0) return [];
  if (count === 1) return [1];
  if (count === 2) return [1, 1];
  if (count === 3) return [1, 2];
  if (count === 4) return [2, 2];
  if (count === 5) return [2, 3];
  if (count === 6) return [2, 2, 2];
  const columns = 3;
  const base = Math.floor(count / columns);
  const remainder = count % columns;
  const sizes = [base, base, base];
  for (let i = 0; i < remainder; i++) sizes[i]++;
  return sizes;
}

// Slices order into per-column id arrays per sizes. Ignores ids beyond sum(sizes).
export function columnsFromSizes(order: string[], sizes: ColumnSizes): string[][] {
  const columns: string[][] = [];
  let idx = 0;
  for (const size of sizes) {
    columns.push(order.slice(idx, idx + size));
    idx += size;
  }
  return columns;
}

// Returns the column index that contains array position `index`, given sizes.
function columnIndexAt(index: number, sizes: ColumnSizes): number {
  let cumulative = 0;
  for (let col = 0; col < sizes.length; col++) {
    cumulative += sizes[col];
    if (index < cumulative) return col;
  }
  return sizes.length - 1;
}

// Reconciles a stored layout against a fresh session order (mirrors mergeOrder for sessionOrder).
// Returns prevSizes unchanged (same ref) if empty or inconsistent (sum !== prevOrder.length) —
// caller falls back to defaultColumnSizes(nextOrder.length) when the result is [].
// Removed ids: decrement their column, drop it at 0 (shift later indices down).
// Added ids: increment the size of whatever is now the LAST column.
// If every column empties, return [] (caller applies the default).
export function mergeColumnSizes(
  prevOrder: string[],
  prevSizes: ColumnSizes,
  nextOrder: string[],
): ColumnSizes {
  if (prevSizes.length === 0) return prevSizes;
  const sum = prevSizes.reduce((a, b) => a + b, 0);
  if (sum !== prevOrder.length) return prevSizes;

  // Record each prevOrder id's original column index before any mutation.
  const columnOf: number[] = [];
  prevSizes.forEach((size, col) => {
    for (let i = 0; i < size; i++) columnOf.push(col);
  });

  const nextSet = new Set(nextOrder);
  const workingSizes = [...prevSizes];
  prevOrder.forEach((id, i) => {
    if (!nextSet.has(id)) {
      workingSizes[columnOf[i]]--;
    }
  });

  const sizes = workingSizes.filter((size) => size > 0);
  if (sizes.length === 0) return [];

  const prevSet = new Set(prevOrder);
  const addedCount = nextOrder.filter((id) => !prevSet.has(id)).length;
  if (addedCount > 0) {
    sizes[sizes.length - 1] += addedCount;
  }

  return sizes;
}

// Moves sessionId into targetId's column. No-op (same refs) if already together or either id
// missing. Splice sessionId out of order (decrement/drop its source column, shifting indices),
// re-locate targetId's column in the post-removal order, splice sessionId in after targetId,
// increment that column's size.
export function joinColumn(
  order: string[],
  sizes: ColumnSizes,
  sessionId: string,
  targetId: string,
): { order: string[]; sizes: ColumnSizes } {
  const sourceIndex = order.indexOf(sessionId);
  const targetIndex = order.indexOf(targetId);
  if (sourceIndex === -1 || targetIndex === -1) return { order, sizes };

  const sourceCol = columnIndexAt(sourceIndex, sizes);
  const targetCol = columnIndexAt(targetIndex, sizes);
  if (sourceCol === targetCol) return { order, sizes };

  const nextOrder = order.filter((id) => id !== sessionId);
  const nextSizes = [...sizes];
  nextSizes[sourceCol]--;
  if (nextSizes[sourceCol] === 0) {
    nextSizes.splice(sourceCol, 1);
  }

  const newTargetIndex = nextOrder.indexOf(targetId);
  const newTargetCol = columnIndexAt(newTargetIndex, nextSizes);
  nextOrder.splice(newTargetIndex + 1, 0, sessionId);
  nextSizes[newTargetCol]++;

  return { order: nextOrder, sizes: nextSizes };
}

// Splits sessionId into a new size-1 column at gutterIndex (0..sizes.length). No-op if
// sessionId missing. Splice out (decrement/drop source column, shift gutterIndex down if it
// pointed past the dropped column), insert into order at sum(sizes[0..gutterIndex)), splice 1
// into sizes at gutterIndex.
export function splitToColumn(
  order: string[],
  sizes: ColumnSizes,
  sessionId: string,
  gutterIndex: number,
): { order: string[]; sizes: ColumnSizes } {
  const sourceIndex = order.indexOf(sessionId);
  if (sourceIndex === -1) return { order, sizes };

  const sourceCol = columnIndexAt(sourceIndex, sizes);

  const nextOrder = order.filter((id) => id !== sessionId);
  const nextSizes = [...sizes];
  nextSizes[sourceCol]--;

  let targetGutter = gutterIndex;
  if (nextSizes[sourceCol] === 0) {
    nextSizes.splice(sourceCol, 1);
    if (sourceCol < targetGutter) targetGutter--;
  }

  let insertAt = 0;
  for (let col = 0; col < targetGutter; col++) insertAt += nextSizes[col];

  nextOrder.splice(insertAt, 0, sessionId);
  nextSizes.splice(targetGutter, 0, 1);

  return { order: nextOrder, sizes: nextSizes };
}
