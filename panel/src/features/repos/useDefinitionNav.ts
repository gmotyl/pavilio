import { useCallback, useEffect, useRef, useState } from "react";

export interface DefinitionLocation {
  path: string;
  line: number;
  col: number;
}

interface Entry {
  file: string;
  line: number;
}

interface Options {
  /** Repo or worktree directory the definition lookup runs in. */
  root: string;
  /** File open in the viewer. */
  file: string | null;
  open: (file: string, line: number) => void;
}

const NOTICE_MS = 2000;
const q = encodeURIComponent;

/**
 * Go-to-definition with an in-memory Back stack. Mount per root: a new repo or
 * worktree starts with an empty stack.
 */
export function useDefinitionNav({ root, file, open }: Options) {
  const [stack, setStack] = useState<Entry[]>([]);
  const [choices, setChoices] = useState<{ from: Entry; locations: DefinitionLocation[] } | null>(null);
  const [notice, setNotice] = useState(false);
  // Bumped on every lookup and every file change, so a late answer is dropped.
  const token = useRef(0);

  useEffect(() => {
    token.current++;
    setChoices(null);
  }, [file]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(false), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  const jump = useCallback(
    (from: Entry, to: DefinitionLocation) => {
      setChoices(null);
      setStack((s) => [...s, from]);
      open(to.path, to.line);
    },
    [open],
  );

  const onIdentifierClick = useCallback(
    (pos: { line: number; col: number }) => {
      if (!file) return;
      const mine = ++token.current;
      const from = { file, line: pos.line };
      setChoices(null);
      fetch(`/api/code/definition?repo=${q(root)}&path=${q(file)}&line=${pos.line}&col=${pos.col}`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return ((await res.json()) as { locations?: DefinitionLocation[] }).locations ?? [];
        })
        .catch(() => [] as DefinitionLocation[])
        .then((locations) => {
          if (token.current !== mine) return;
          if (locations.length === 0) setNotice(true);
          else if (locations.length === 1) jump(from, locations[0]);
          else setChoices({ from, locations });
        });
    },
    [root, file, jump],
  );

  const back = useCallback(() => {
    const prev = stack.at(-1);
    if (!prev) return;
    setStack(stack.slice(0, -1));
    open(prev.file, prev.line);
  }, [stack, open]);

  return {
    onIdentifierClick,
    canBack: stack.length > 0,
    back,
    choices: choices?.locations ?? null,
    choose: (to: DefinitionLocation) => choices && jump(choices.from, to),
    dismiss: () => setChoices(null),
    notice,
  };
}
