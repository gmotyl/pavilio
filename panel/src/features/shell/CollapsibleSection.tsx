import { useState, ReactNode } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";

interface Props {
  storageKey: string;
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}

export default function CollapsibleSection({ storageKey, title, icon, children }: Props) {
  const [expanded, setExpanded] = useState(true);

  return (
    <section>
      <button
        type="button"
        data-testid={`collapsible-section-${storageKey}`}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
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
