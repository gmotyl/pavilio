/**
 * The segment-state rule moved to `features/speech/segmentState.ts` with the
 * transport that reads it: speech may not import from terminal (see
 * `features/speech/__tests__/importDirection.guard.test.ts`). Re-exported here
 * so terminal-side readers keep their import path.
 */
export { segmentStateFor, type SegmentState } from "../speech/segmentState";
