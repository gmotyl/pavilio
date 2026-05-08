import { Link } from "react-router-dom";
import { useGitStatus } from "./useGitStatus";

export default function GitSummary() {
  const { files } = useGitStatus();
  const modified = files.filter((f) => f.status === "M").length;
  const newFiles = files.filter((f) => f.status === "??").length;

  // Always render as a Link to /git — even when the working tree is clean,
  // the user may want to land on the Git page (pull, browse history, etc.).
  return (
    <Link
      to="/git"
      className="flex items-center gap-2 text-[13px] px-2 py-1.5 rounded-md transition-colors"
      style={{ color: "var(--text-secondary)" }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = "var(--bg-hover)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {files.length === 0 ? (
        <span style={{ color: "var(--text-muted)" }}>Clean</span>
      ) : (
        <>
          {modified > 0 && (
            <span style={{ color: "var(--yellow)" }}>{modified}M</span>
          )}
          {newFiles > 0 && (
            <span style={{ color: "var(--green)" }}>{newFiles}U</span>
          )}
          <span style={{ color: "var(--text-muted)" }}>
            {files.length} files
          </span>
        </>
      )}
    </Link>
  );
}
