import { useState, useEffect, useCallback } from "react";
import { useWebSocket } from "../realtime/useWebSocket";

export type RootId = "projects" | "skills" | "claude-commands" | "opencode-commands";

export interface FileEntry {
  relativePath: string;
  project: string;     // first path segment (used by buildTree)
  modified: number;
  root?: RootId;
}

export function useFileIndex(root: RootId = "projects") {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const { lastMessage } = useWebSocket();

  const fetchFiles = useCallback(async () => {
    const url =
      root === "projects" ? "/api/files/index" : `/api/files/listing?root=${root}`;
    const res = await fetch(url);
    if (!res.ok) {
      setFiles([]);
      return;
    }
    const raw: Array<{ relativePath: string; project?: string; modified: number }> =
      await res.json();
    setFiles(
      raw.map((f) => ({
        relativePath: f.relativePath,
        project: f.project ?? f.relativePath.split("/")[0] ?? "",
        modified: f.modified,
        root,
      }))
    );
  }, [root]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  useEffect(() => {
    if (lastMessage?.type === "file-change") fetchFiles();
  }, [lastMessage, fetchFiles]);

  return files;
}
