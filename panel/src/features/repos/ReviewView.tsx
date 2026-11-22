import { createPortal } from "react-dom";
import type { ReposViewProps } from "./types";

/** Placeholder until the Review view lands; owns the PR switcher in the context slot. */
export default function ReviewView({ contextSlot }: ReposViewProps) {
  return (
    <>
      {contextSlot && createPortal(<span data-testid="pr-switcher" className="rt-placeholder">Pick a pull request</span>, contextSlot)}
      <p className="rt-placeholder" data-testid="review-view">Review</p>
    </>
  );
}
