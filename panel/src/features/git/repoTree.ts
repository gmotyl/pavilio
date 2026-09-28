import type { PaneBounds } from "../shell/useResizablePane";

/**
 * How far a repo file tree may be dragged. The floor keeps a path column
 * readable rather than a stack of ellipses; the ceiling is tighter than the
 * file list's because these trees share their row with a DIFF, which wants
 * every column it can get. `step` is the arrow-key increment.
 *
 * One object rather than a constant per view: the changed-path trees are the
 * same tree in several places, so a bound that drifted in one of them would be
 * a difference you could only find by dragging each handle to its stop.
 */
export const TREE_BOUNDS: PaneBounds = { min: 200, max: 480, step: 16 };
