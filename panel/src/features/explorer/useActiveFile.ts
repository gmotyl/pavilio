import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { createElement } from "react";

interface ActiveFileContext {
  /** Currently viewed file path (relative, e.g. "my-work/notes/daily.md") */
  activeFile: string | null;
  setActiveFile: (path: string | null) => void;
}

const Ctx = createContext<ActiveFileContext>({ activeFile: null, setActiveFile: () => {} });

export function ActiveFileProvider({ children }: { children: ReactNode }) {
  const [activeFile, setActiveFileState] = useState<string | null>(null);
  const setActiveFile = useCallback((path: string | null) => setActiveFileState(path), []);
  return createElement(Ctx.Provider, { value: { activeFile, setActiveFile } }, children);
}

export function useActiveFile() {
  return useContext(Ctx);
}
