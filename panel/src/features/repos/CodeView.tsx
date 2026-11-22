import { createPortal } from "react-dom";
import type { ReposViewProps } from "./types";

/** Placeholder until the Code view lands; owns the repo switcher in the context slot. */
export default function CodeView({ contextSlot }: ReposViewProps) {
  return (
    <>
      {contextSlot && createPortal(<span data-testid="repo-switcher" className="rt-placeholder">Pick a repository</span>, contextSlot)}
      <p className="rt-placeholder" data-testid="code-view">Code</p>
    </>
  );
}
