import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useActiveFile } from "../explorer/useActiveFile";
import { useWebSocket } from "../realtime/useWebSocket";
import {
  clearLastSectionFile,
  writeLastSectionFile,
} from "../shell/lastPath";

interface Options {
  project: string | undefined;
  section: string | undefined;
}

export function useFileViewer({ project, section }: Options) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { setActiveFile } = useActiveFile();
  const { lastMessage } = useWebSocket();

  const selectedFile = searchParams.get("file");
  const [content, setContent] = useState("");
  const [absolutePath, setAbsolutePath] = useState("");
  const [loading, setLoading] = useState(false);

  const setSelectedFile = useCallback(
    (path: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (path) next.set("file", path);
          else next.delete("file");
          return next;
        },
        { replace: true },
      );
      setActiveFile(path);
    },
    [setSearchParams, setActiveFile],
  );

  // Load file when selection changes
  useEffect(() => {
    if (!selectedFile) return;
    setLoading(true);
    fetch(`/api/files/read/${selectedFile}`)
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          setContent(data.content);
          setAbsolutePath(data.absolutePath || "");
        } else {
          setSelectedFile(null);
        }
      })
      .finally(() => setLoading(false));
  }, [selectedFile, setSelectedFile]);

  // Persist last-open file per section so tab links can restore it
  useEffect(() => {
    if (!project || !section) return;
    if (section === "repos" || section === "iterm") return;
    if (selectedFile) {
      writeLastSectionFile(project, section, selectedFile);
    } else {
      clearLastSectionFile(project, section);
    }
  }, [project, section, selectedFile]);

  // Live-reload on file-change websocket events
  useEffect(() => {
    if (!selectedFile || lastMessage?.type !== "file-change") return;
    const changedPath = lastMessage.path as string;
    if (changedPath?.includes(selectedFile)) {
      fetch(`/api/files/read/${selectedFile}`).then(async (res) => {
        if (res.ok) setContent((await res.json()).content);
      });
    }
  }, [lastMessage, selectedFile]);

  return {
    selectedFile,
    content,
    absolutePath,
    loading,
    setSelectedFile,
  };
}
