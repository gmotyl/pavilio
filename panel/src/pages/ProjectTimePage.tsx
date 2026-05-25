import { useParams, Link } from "react-router-dom";

export default function ProjectTimePage() {
  const { name } = useParams<{ name: string }>();
  return (
    <div className="p-6">
      <header className="flex items-center gap-3 mb-6">
        <Link to={`/project/${name}`} className="text-sm" style={{ color: "var(--text-tertiary)" }}>
          ← Back to project
        </Link>
        <h1 className="text-2xl capitalize">{name} · Time</h1>
      </header>
      <p style={{ color: "var(--text-muted)" }}>No entries yet.</p>
    </div>
  );
}
