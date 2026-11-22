import type { ReposViewProps } from "./types";

/** Placeholder until the PRs view lands; it has no context switcher. */
export default function PrsView(_props: ReposViewProps) {
  return <p className="rt-placeholder" data-testid="prs-view">Pull requests</p>;
}
