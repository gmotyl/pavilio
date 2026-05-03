import { useCallback, useEffect, useRef, useState } from "react";
import type { GrepResult } from "../search/grep";

interface Options {
  project: string | undefined;
  enabled: boolean;
  onOpenResult: (relativePath: string) => void;
}

export function useProjectSearch({ project, enabled, onOpenResult }: Options) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GrepResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset on project change
  useEffect(() => {
    setQuery("");
    setResults([]);
    setActive(false);
  }, [project]);

  // Cmd/Ctrl+F to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f" && project) {
        e.preventDefault();
        setActive(true);
        setTimeout(() => inputRef.current?.focus(), 10);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [project]);

  // Debounced grep against project files
  useEffect(() => {
    if (!enabled) return;
    if (query.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search/grep?q=${encodeURIComponent(query)}&project=${encodeURIComponent(project ?? "")}`,
          { signal: abort.signal },
        );
        if (res.ok) setResults(await res.json());
        else setResults([]);
      } catch (e: any) {
        if (e.name !== "AbortError") setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, project, enabled]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        setActive(false);
        setQuery("");
        setResults([]);
        return;
      }
      const count = results.length;
      if (!count) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => (i + 1) % count);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => (i - 1 + count) % count);
      } else if (e.key === "Enter") {
        const r = results[selectedIdx];
        if (r) onOpenResult(r.relativePath);
      }
    },
    [results, selectedIdx, onOpenResult],
  );

  const close = useCallback(() => {
    setActive(false);
    setQuery("");
    setResults([]);
  }, []);

  const toggle = useCallback(() => {
    setActive((a) => !a);
    setTimeout(() => inputRef.current?.focus(), 10);
  }, []);

  return {
    query,
    setQuery,
    results,
    loading,
    active,
    setActive,
    selectedIdx,
    setSelectedIdx,
    inputRef,
    handleKeyDown,
    close,
    toggle,
  };
}
