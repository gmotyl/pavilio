import { useSyncExternalStore } from "react";
import {
  type GitFile,
  getGitStatusSnapshot,
  requestGitStatusRefresh,
  subscribeGitStatus,
} from "./gitStatusStore";

/** Working-tree status from the shared store; every consumer reads one fetch. */
export function useGitStatus(): { files: GitFile[]; refetch: () => void } {
  const { files } = useSyncExternalStore(subscribeGitStatus, getGitStatusSnapshot);
  return { files, refetch: requestGitStatusRefresh };
}
