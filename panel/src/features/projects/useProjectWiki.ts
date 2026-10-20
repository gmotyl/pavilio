import { useCallback, useEffect, useState } from "react";
import { useWebSocket } from "../realtime/useWebSocket";
import type { WikiPageInfo, WikiTree } from "../../../server/lib/wiki/tree";

export type { WikiPageInfo, WikiTree };

/**
 * The wiki tab's tree (`GET /api/projects/:name/wiki`). Every path in it is
 * project-relative with `.md` (`wiki/concepts/x.md`). Refreshes when a file
 * under the project's `wiki/` changes, so pages an ingest writes appear live.
 */
export function useProjectWiki(projectName: string) {
  const { lastMessage } = useWebSocket();
  const [data, setData] = useState<WikiTree | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectName) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/wiki`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectName]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (lastMessage?.type !== "file-change") return;
    const changed = lastMessage.path as string | undefined;
    if (!changed || changed.includes(`${projectName}/wiki/`)) refresh();
  }, [lastMessage, projectName, refresh]);

  return { data, loading, error, refresh };
}

/**
 * One wiki page's source through the files API the markdown viewer reads
 * (`/api/files/read/<project>/wiki/...md`), live-reloaded on change.
 */
export function useWikiPage(file: string | null) {
  const { lastMessage } = useWebSocket();
  const [content, setContent] = useState<string | null>(null);
  const [absolutePath, setAbsolutePath] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (path: string, isCancelled: () => boolean) =>
      fetch(`/api/files/read/${path}`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`Not found (${res.status})`);
          const data = await res.json();
          if (isCancelled()) return;
          setContent(data.content);
          setAbsolutePath(data.absolutePath || "");
        })
        .catch((e) => {
          if (!isCancelled()) setError(e instanceof Error ? e.message : String(e));
        }),
    [],
  );

  useEffect(() => {
    setContent(null);
    setError(null);
    setAbsolutePath("");
    if (!file) return;
    let cancelled = false;
    load(file, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [file, load]);

  useEffect(() => {
    if (!file || lastMessage?.type !== "file-change") return;
    if ((lastMessage.path as string | undefined)?.includes(file)) load(file, () => false);
  }, [lastMessage, file, load]);

  return { content, absolutePath, error };
}
