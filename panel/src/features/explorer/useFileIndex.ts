import { useState, useEffect, useCallback } from "react";
import { useWebSocket } from "../realtime/useWebSocket";

export type RootId = "projects" | "skills" | "claude-commands" | "opencode-commands";

export interface FileEntry {
  relativePath: string;
  project: string;     // first path segment (used by buildTree)
  modified: number;
  archived?: boolean;
  root?: RootId;
}

const REFRESH_EVENT = "pavilio:file-index-refresh";

/**
 * Asks every mounted `useFileIndex` to re-fetch now — for a write the panel
 * made itself (e.g. a mockup import), so the list does not wait for the
 * watcher's `file-change` broadcast.
 */
export function refreshFileIndex() {
  window.dispatchEvent(new Event(REFRESH_EVENT));
}

/**
 * How long a failed first load waits before the next try, by failure count:
 * 2s, 5s, 10s, then every 30s until the index has loaded once.
 */
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000];

const retryDelay = (failures: number) => RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length) - 1];

/**
 * The file index and whether it has loaded at least once: until then `files`
 * is an empty placeholder, not "no files", so a caller that reads absence as
 * meaning (e.g. "this PR has no story") must wait for `loaded`. `error` is
 * true while the latest fetch failed (non-OK, network error or bad JSON); a
 * failed first load retries on a bounded backoff until one succeeds.
 */
export function useFileIndexState(root: RootId = "projects"): { files: FileEntry[]; loaded: boolean; error: boolean } {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Fetches failed in a row; zero once one succeeds.
  const [failures, setFailures] = useState(0);
  const { lastMessage } = useWebSocket();

  const fetchFiles = useCallback(async () => {
    const url =
      root === "projects" ? "/api/files/index" : `/api/files/listing?root=${root}`;
    let raw: Array<{ relativePath: string; project?: string; modified: number; archived?: boolean }>;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        setFiles([]);
        setFailures((n) => n + 1);
        return;
      }
      raw = await res.json();
    } catch {
      setFailures((n) => n + 1);
      return;
    }
    setFiles(
      raw.map((f) => ({
        relativePath: f.relativePath,
        project: f.project ?? f.relativePath.split("/")[0] ?? "",
        modified: f.modified,
        archived: f.archived ?? false,
        root,
      }))
    );
    setFailures(0);
    setLoaded(true);
  }, [root]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  // Each failure before the first success schedules the next try; a success,
  // unmount or root change clears the pending one.
  useEffect(() => {
    if (loaded || failures === 0) return;
    const timer = setTimeout(() => void fetchFiles(), retryDelay(failures));
    return () => clearTimeout(timer);
  }, [loaded, failures, fetchFiles]);

  useEffect(() => {
    if (lastMessage?.type === "file-change") fetchFiles();
  }, [lastMessage, fetchFiles]);

  useEffect(() => {
    const onRefresh = () => void fetchFiles();
    window.addEventListener(REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(REFRESH_EVENT, onRefresh);
  }, [fetchFiles]);

  return { files, loaded, error: failures > 0 };
}

export function useFileIndex(root: RootId = "projects") {
  return useFileIndexState(root).files;
}
