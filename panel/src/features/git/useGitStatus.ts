import { useState, useEffect } from "react";
import { useWebSocket } from "../realtime/useWebSocket";
import { useAllTerminalSessions } from "../terminal/useAllTerminalSessions";
import {
  subscribeActivity,
  getActivityState,
} from "../terminal/useTerminalActivityChannel";

interface GitFile {
  status: string;
  path: string;
}

interface GitStatus {
  files: GitFile[];
  suggestion: string;
}

export function useGitStatus() {
  const [status, setStatus] = useState<GitStatus>({
    files: [],
    suggestion: "",
  });
  const { lastMessage } = useWebSocket();

  const fetchStatus = async () => {
    const [statusRes, suggestRes] = await Promise.all([
      fetch("/api/git/status"),
      fetch("/api/git/suggest-message"),
    ]);
    const files = statusRes.ok ? await statusRes.json() : [];
    const { suggestion = "" } = suggestRes.ok ? await suggestRes.json() : {};
    setStatus({ files, suggestion });
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    if (lastMessage?.type === "file-change" || lastMessage?.type === "git-change") fetchStatus();
  }, [lastMessage]);

  const { sessions } = useAllTerminalSessions();
  useEffect(() => {
    const unsubs = sessions.map((s) =>
      subscribeActivity(s.id, () => {
        if (getActivityState(s.id) === "attention") fetchStatus();
      }),
    );
    return () => unsubs.forEach((u) => u());
  }, [sessions]);

  return { ...status, refetch: fetchStatus };
}
