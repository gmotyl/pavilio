import { Link } from "react-router-dom";
import { ProjectMark } from "./ProjectMark";
import { useProjects } from "./useProjects";
import { projectHref } from "../shell/projectHref";
import { useIsMobile } from "../shell/useIsMobile";

/**
 * Overview strip for a grouped project: `Group: <Name>` and a chip per sibling.
 * Siblings come from `useProjects`, which already leaves archived projects out.
 * Renders nothing when the project has no group.
 */
export default function ProjectGroupStrip({ project }: { project: string }) {
  const projects = useProjects();
  const isMobile = useIsMobile();
  const self = projects.find((p) => p.name === project);
  const group = typeof self?.group === "string" && self.group ? self.group : null;
  if (!group) return null;
  const siblings = projects.filter((p) => p.name !== project && p.group === group);
  return (
    <nav
      aria-label="Project group"
      className="flex flex-wrap items-center gap-2 text-xs mb-2"
      style={{ color: "var(--text-muted)" }}
    >
      <span>
        Group: <b style={{ color: "var(--text)" }}>{group}</b>
      </span>
      {siblings.map((s) => (
        <Link
          key={s.name}
          to={projectHref(s.name, isMobile)}
          className="inline-flex items-center gap-1 rounded pl-0.5 pr-2 py-0.5"
          style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text)" }}
        >
          <ProjectMark project={s.name} size={16} kind={s.kind} />
          {s.name}
        </Link>
      ))}
    </nav>
  );
}
