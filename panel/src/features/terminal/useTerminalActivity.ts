import { useActivityState, type ActivityState } from "./useTerminalActivityChannel";

export type TerminalActivity = ActivityState;

export function useTerminalActivity(sessionId: string): ActivityState {
  return useActivityState(sessionId);
}
