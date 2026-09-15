/** Which source the cell reader is showing. */
export type CellReaderTab = "screen" | "answer";

export const STORAGE_KEY = "panel:cellReader:tab";

const DEFAULT_TAB: CellReaderTab = "screen";

function isCellReaderTab(value: unknown): value is CellReaderTab {
  return value === "screen" || value === "answer";
}

/**
 * The source this browser last chose, or `"screen"` when nothing has been
 * chosen yet or storage is unavailable. Never throws.
 */
export function readCellReaderTab(): CellReaderTab {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // A hand-edited value, or one left by an older build, must not leak
    // through as a tab the reader does not know how to render.
    return isCellReaderTab(raw) ? raw : DEFAULT_TAB;
  } catch {
    return DEFAULT_TAB;
  }
}

/** Remember the chosen source. A storage failure is swallowed. */
export function writeCellReaderTab(tab: CellReaderTab): void {
  try {
    localStorage.setItem(STORAGE_KEY, tab);
  } catch {
    /* localStorage disabled — silent no-op */
  }
}
