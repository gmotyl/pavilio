import { Link, useNavigate } from "react-router-dom";
import { useFavorites } from "./useFavorites";
import { useProjects, Project } from "./useProjects";
import { MobileAccessButton } from "../mobile-access/MobileAccessButton";
import { useFileDropTarget } from "../explorer/useFileDrag";
import {
  FolderOpen,
  FileText,
  TrendingUp,
  Map as MapIcon,
  Database,
  Star,
  Terminal as TerminalIcon,
} from "lucide-react";

function formatDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function Badge({
  label,
  icon: Icon,
}: {
  label: string;
  icon: typeof FileText;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded"
      style={{ background: "var(--bg-hover)", color: "var(--text-tertiary)" }}
    >
      <Icon size={10} />
      {label}
    </span>
  );
}

function ProjectCard({
  project,
  isFav,
  onToggleFav,
}: {
  project: Project;
  isFav: boolean;
  onToggleFav: () => void;
}) {
  const navigate = useNavigate();
  const formattedDate = formatDate(project.latestProgressDate);
  const { hover, dropHandlers } = useFileDropTarget(project.name);

  return (
    <div
      {...dropHandlers}
      data-testid={`dashboard-project-card-${project.name}`}
      className="rounded-xl p-4 cursor-pointer transition-all duration-200 group relative"
      style={{
        background: hover ? "var(--accent-dim, var(--bg-elevated))" : "var(--bg-surface)",
        border: `1px solid ${hover ? "var(--accent)" : isFav ? "var(--accent-dim)" : "var(--border-subtle)"}`,
      }}
      onClick={() => navigate(`/project/${project.name}`)}
      onMouseEnter={(e) => {
        if (hover) return;
        e.currentTarget.style.borderColor = "var(--border-strong)";
        e.currentTarget.style.background = "var(--bg-elevated)";
      }}
      onMouseLeave={(e) => {
        if (hover) return;
        e.currentTarget.style.borderColor = isFav
          ? "rgba(229,168,75,0.15)"
          : "var(--border-subtle)";
        e.currentTarget.style.background = "var(--bg-surface)";
      }}
    >
      <button
        data-testid={`dashboard-project-favorite-${project.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFav();
        }}
        className="absolute top-3 right-3 p-1 rounded transition-all"
        style={{ opacity: isFav ? 1 : 0 }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
        onMouseLeave={(e) => {
          if (!isFav) e.currentTarget.style.opacity = "0";
        }}
      >
        <Star
          size={14}
          fill={isFav ? "var(--accent)" : "none"}
          style={{ color: isFav ? "var(--accent)" : "var(--text-muted)" }}
          className="group-hover:!opacity-100"
        />
      </button>

      <div className="flex items-center gap-2 mb-3">
        <FolderOpen size={16} style={{ color: "var(--accent)" }} />
        <h2 className="text-[15px] font-semibold">{project.name}</h2>
      </div>

      <div className="flex flex-wrap gap-1 mb-3">
        {project.hasNotes && <Badge label="Notes" icon={FileText} />}
        {project.hasProgress && <Badge label="Progress" icon={TrendingUp} />}
        {project.hasPlans && <Badge label="Plans" icon={MapIcon} />}
        {project.hasIndex && <Badge label="Index" icon={Database} />}
      </div>

      {/* Active plans are no longer a project-level pointer (CURRENT.md is gone).
          They live in un-archived OpenSpec change directories, surfaced on the
          project's Plans tab; deriving them here would mean a plans-tree fetch
          per card, so the dashboard no longer previews them. */}

      {formattedDate && (
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          Last active {formattedDate}
        </p>
      )}
    </div>
  );
}

export default function Dashboard() {
  const projects = useProjects();
  const { toggle, isFavorite, sortWithFavorites } = useFavorites();

  const sorted = sortWithFavorites(projects);

  return (
    <div className="p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Projects</h1>
          <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
            {projects.length} projects in workspace
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/terminals"
            data-testid="dashboard-terminals-link"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm transition-all"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-hover)";
              e.currentTarget.style.borderColor = "var(--border-strong)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--bg-surface)";
              e.currentTarget.style.borderColor = "var(--border-subtle)";
            }}
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--border-subtle)",
              color: "var(--text-primary)",
            }}
          >
            <TerminalIcon size={14} />
            <span>Terminals</span>
          </Link>
          <MobileAccessButton />
        </div>
      </div>
      {projects.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>Loading...</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {sorted.map((project) => (
            <ProjectCard
              key={project.name}
              project={project}
              isFav={isFavorite(project.name)}
              onToggleFav={() => toggle(project.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
