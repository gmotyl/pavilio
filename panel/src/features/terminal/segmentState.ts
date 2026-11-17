/**
 * The segment-state rule lives in `features/speech/segmentState.ts` with the
 * transport that reads it: speech may not import from terminal (see
 * `features/speech/__tests__/importDirection.guard.test.ts`). Only the type is
 * re-exported here, for the terminal-side bar that names it.
 */
export type { SegmentState } from "../speech/segmentState";
