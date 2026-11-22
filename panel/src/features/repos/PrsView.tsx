import type { ReactNode } from "react";
import type { Unavailable } from "../../../server/lib/prs/provider";
import PrFilter from "./PrFilter";
import PrRow, { prKey } from "./PrRow";
import type { ReposViewProps } from "./types";
import "./Prs.css";

const RESTING: Record<Exclude<Unavailable, "failed">, ReactNode> = {
  "not-github": "No GitHub remote",
  "gh-missing": (
    <>
      <code>gh</code> is not installed
    </>
  ),
  "gh-unauthenticated": (
    <>
      Run <code>gh auth login</code>
    </>
  ),
};

/** Full-width list of the project's open PRs under the remembered filter; no context switcher. */
export default function PrsView({ project, prs, filter, setFilter, params, setParams }: ReposViewProps) {
  const current = params.get("pr");
  const showingAll = filter.preset === "all" && filter.author === null;

  if (prs.error) {
    return (
      <div className="prs-status" role="alert" data-testid="prs-view">
        Couldn't load pull requests ({prs.error}).{" "}
        <button type="button" data-testid="prs-retry" onClick={prs.reload}>
          Retry
        </button>
      </div>
    );
  }

  let body: ReactNode;
  if (prs.loading && prs.me === null) body = <p className="prs-status">Loading pull requests…</p>;
  else if (prs.prs.length > 0)
    body = (
      <ul className="pr-list" role="listbox" aria-label="Open pull requests">
        {prs.prs.map((p) => (
          <PrRow
            key={prKey(p)}
            pr={p}
            me={prs.me}
            selected={prKey(p) === current}
            onOpen={(open) => setParams({ view: "review", pr: prKey(open) })}
          />
        ))}
      </ul>
    );
  else
    body = (
      <p className="prs-empty">
        No open pull requests match.
        {!showingAll && (
          <>
            {" "}
            <button type="button" data-testid="prs-show-all" onClick={() => setFilter({ preset: "all", author: null })}>
              Show all
            </button>
          </>
        )}
      </p>
    );

  return (
    <div data-testid="prs-view">
      <PrFilter
        project={project}
        me={prs.me}
        filter={filter}
        setFilter={setFilter}
        counts={prs.counts}
        authors={prs.authors}
      />
      {prs.unavailable.length > 0 && (
        <ul className="prs-unavailable" aria-label="Unavailable repositories">
          {prs.unavailable.map(({ repo, reason }) => (
            <li key={repo}>
              <span className="pr-repo">{repo}</span>
              {reason === "failed" ? (
                <>
                  <span>Couldn't load pull requests</span>
                  <button type="button" data-testid={`prs-retry-${repo}`} onClick={prs.reload}>
                    Retry
                  </button>
                </>
              ) : (
                <span>{RESTING[reason]}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {body}
    </div>
  );
}
