import { ReactNode } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { preferences } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";

interface Props {
  storageKey: string;
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}

export default function CollapsibleSection({ storageKey, title, icon, children }: Props) {
  // The section key is the scope. Every caller passes a literal ("explorer",
  // "skills", "commands"), so there is no unresolved-scope case to guard.
  const [expanded, setExpanded] = usePreference(
    preferences.rightSidebarSectionExpanded,
    storageKey,
  );

  return (
    <section>
      <button
        type="button"
        data-testid={`collapsible-section-${storageKey}`}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 mb-2 px-1 w-full text-left"
      >
        {expanded ? (
          <ChevronDown size={12} style={{ color: "var(--text-tertiary)" }} />
        ) : (
          <ChevronRight size={12} style={{ color: "var(--text-tertiary)" }} />
        )}
        {icon}
        <h2
          className="text-[11px] font-semibold uppercase tracking-widest"
          style={{ color: "var(--text-tertiary)" }}
        >
          {title}
        </h2>
      </button>
      {expanded && <div>{children}</div>}
    </section>
  );
}
