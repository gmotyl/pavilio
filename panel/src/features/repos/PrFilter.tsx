import type { PrFilter as PrFilterValue, PrFilterPreset } from "../../preferences/declarations";
import type { PreferenceSetter } from "../../preferences/usePreference";
import type { PresetCounts } from "./usePrs";
import "./Prs.css";

interface Props {
  project: string;
  me: string | null;
  filter: PrFilterValue;
  setFilter: PreferenceSetter<PrFilterValue>;
  counts: PresetCounts;
  authors: string[];
}

const PRESETS: { preset: PrFilterPreset; label: string }[] = [
  { preset: "mine", label: "Mine" },
  { preset: "review", label: "Review requested" },
  { preset: "all", label: "All" },
];

/** Preset chips + author select; the value is the project's remembered `repos.prFilter`. */
export default function PrFilter({ project, me, filter, setFilter, counts, authors }: Props) {
  return (
    <div className="prf" role="group" aria-label="Filter pull requests">
      {PRESETS.map(({ preset, label }) => (
        <button
          key={preset}
          type="button"
          className="prf-chip"
          data-testid={`pr-filter-${preset}`}
          aria-pressed={filter.preset === preset}
          onClick={() => setFilter((prev) => ({ ...prev, preset }))}
        >
          {label}
          <span className="prf-n">{counts[preset]}</span>
        </button>
      ))}
      <select
        className="prf-author"
        aria-label="Author"
        data-testid="pr-filter-author"
        value={filter.author ?? ""}
        onChange={(e) => {
          const author = e.target.value || null;
          setFilter((prev) => ({ ...prev, author }));
        }}
      >
        <option value="">Any author</option>
        {/* A remembered author with no open PRs stays selectable, else the select would lie. */}
        {(filter.author && !authors.includes(filter.author) ? [...authors, filter.author] : authors).map((a) => (
          <option key={a} value={a}>
            {a === me ? `you (${a})` : a}
          </option>
        ))}
      </select>
      <span className="prf-remember" title="Saved for this project">
        Remembered for {project}
      </span>
    </div>
  );
}
