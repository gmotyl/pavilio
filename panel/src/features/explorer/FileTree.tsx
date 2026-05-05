import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  ChevronRight,
  ChevronDown,
  FileText,
  FileJson,
  File,
} from "lucide-react";
import { useGitStatus } from "../git/useGitStatus";
import { useActiveFile } from "./useActiveFile";
import { useFileIndex, FileEntry } from "./useFileIndex";

function getFileIcon(name: string) {
  if (name.endsWith(".md"))
    return (
      <FileText
        size={13}
        className="shrink-0"
        style={{ color: "var(--text-tertiary)" }}
      />
    );
  if (name.endsWith(".json"))
    return (
      <FileJson
        size={13}
        className="shrink-0"
        style={{ color: "var(--text-tertiary)" }}
      />
    );
  return (
    <File
      size={13}
      className="shrink-0"
      style={{ color: "var(--text-tertiary)" }}
    />
  );
}

function GitIndicator({ status }: { status: string }) {
  const color =
    status === "M"
      ? "var(--yellow)"
      : status === "??"
        ? "var(--green)"
        : status === "D"
          ? "var(--red)"
          : "var(--text-tertiary)";
  const letter = status === "??" ? "U" : status.charAt(0);
  return (
    <span
      className="text-[10px] font-mono font-semibold shrink-0 ml-auto"
      style={{ color }}
    >
      {letter}
    </span>
  );
}

interface FolderNode {
  [subfolder: string]: FileEntry[];
}
interface ProjectNode {
  root: FileEntry[];
  subfolders: FolderNode;
}

export function buildTree(files: FileEntry[]): Record<string, ProjectNode> {
  const tree: Record<string, ProjectNode> = {};
  for (const file of files) {
    const parts = file.relativePath.split("/");
    const project = parts[0];
    if (!tree[project]) tree[project] = { root: [], subfolders: {} };
    if (parts.length === 2) {
      tree[project].root.push(file);
    } else {
      const subfolder = parts[1];
      if (!tree[project].subfolders[subfolder])
        tree[project].subfolders[subfolder] = [];
      tree[project].subfolders[subfolder].push(file);
    }
  }
  return tree;
}

/** Parse /view/project/subfolder/file.md into segments */
export function parseViewPath(pathname: string) {
  const m = pathname.match(/^\/view\/([^/]+)(?:\/([^/]+))?/);
  if (!m) return null;
  return { project: m[1], subfolder: m[2] || "" };
}

function FileButton({
  file,
  isActive,
  gitStatus,
  onNavigate,
}: {
  file: FileEntry;
  isActive: boolean;
  gitStatus?: string;
  onNavigate: (path: string) => void;
}) {
  const fileName = file.relativePath.split("/").pop() ?? file.relativePath;
  const viewPath = `/view/${file.relativePath}`;
  const ref = useRef<HTMLButtonElement>(null);

  // Auto-scroll when this becomes the active file
  useEffect(() => {
    if (isActive && ref.current) {
      ref.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isActive]);

  return (
    <button
      ref={ref}
      data-testid={`file-tree-file-${file.relativePath}`}
      onClick={() => onNavigate(viewPath)}
      title={file.relativePath}
      className="flex items-center gap-1 w-full px-1 py-0.5 rounded-md text-xs truncate transition-colors duration-100"
      style={{
        color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
        background: isActive ? "var(--bg-active)" : "transparent",
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        if (!isActive)
          e.currentTarget.style.background = isActive
            ? "var(--bg-active)"
            : "transparent";
      }}
    >
      {getFileIcon(fileName)}
      <span className="truncate">{fileName}</span>
      {gitStatus && <GitIndicator status={gitStatus} />}
    </button>
  );
}

function SubfolderSection({
  name,
  files,
  currentPath,
  gitMap,
  onNavigate,
  shouldOpen,
}: {
  name: string;
  files: FileEntry[];
  currentPath: string;
  gitMap: Map<string, string>;
  onNavigate: (path: string) => void;
  shouldOpen: boolean;
}) {
  const [open, setOpen] = useState(shouldOpen);
  const prevShouldOpen = useRef(shouldOpen);

  // React to navigation: open when shouldOpen becomes true
  useEffect(() => {
    if (shouldOpen && !prevShouldOpen.current) setOpen(true);
    prevShouldOpen.current = shouldOpen;
  }, [shouldOpen]);

  return (
    <div>
      <button
        data-testid={`file-tree-subfolder-${name}`}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 w-full px-1 py-0.5 rounded-md text-xs transition-colors duration-100"
        style={{ color: "var(--text-secondary)" }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "var(--bg-hover)")
        }
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="truncate">{name}/</span>
        <span
          className="ml-auto text-[10px]"
          style={{ color: "var(--text-muted)" }}
        >
          {files.length}
        </span>
      </button>
      {open && (
        <div
          className="ml-3 pl-1"
          style={{ borderLeft: "1px solid var(--border-subtle)" }}
        >
          {files.map((file) => (
            <FileButton
              key={file.relativePath}
              file={file}
              isActive={currentPath === `/view/${file.relativePath}`}
              gitStatus={gitMap.get(`projects/${file.relativePath}`)}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectTreeSection({
  name,
  node,
  currentPath,
  gitMap,
  onNavigate,
  shouldOpen,
  activeSubfolder,
}: {
  name: string;
  node: ProjectNode;
  currentPath: string;
  gitMap: Map<string, string>;
  onNavigate: (path: string) => void;
  shouldOpen: boolean;
  activeSubfolder: string;
}) {
  const [open, setOpen] = useState(shouldOpen);
  const prevShouldOpen = useRef(shouldOpen);
  const subfolderNames = Object.keys(node.subfolders).sort();

  useEffect(() => {
    if (shouldOpen && !prevShouldOpen.current) setOpen(true);
    prevShouldOpen.current = shouldOpen;
  }, [shouldOpen]);

  return (
    <div className="mb-0.5">
      <button
        data-testid={`file-tree-project-${name}`}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 w-full px-1 py-1 rounded-md text-xs font-medium transition-colors duration-100"
        style={{ color: "var(--text-primary)" }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "var(--bg-hover)")
        }
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="truncate">{name}</span>
      </button>
      {open && (
        <div
          className="ml-3 pl-1"
          style={{ borderLeft: "1px solid var(--border-subtle)" }}
        >
          {subfolderNames.map((subfolder) => (
            <SubfolderSection
              key={subfolder}
              name={subfolder}
              files={node.subfolders[subfolder]}
              currentPath={currentPath}
              gitMap={gitMap}
              onNavigate={onNavigate}
              shouldOpen={activeSubfolder === subfolder}
            />
          ))}
          {node.root.map((file) => (
            <FileButton
              key={file.relativePath}
              file={file}
              isActive={currentPath === `/view/${file.relativePath}`}
              gitStatus={gitMap.get(`projects/${file.relativePath}`)}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FileTree() {
  const files = useFileIndex();
  const { files: gitFiles } = useGitStatus();
  const navigate = useNavigate();
  const location = useLocation();
  const { activeFile } = useActiveFile();
  const tree = buildTree(files);
  const projectNames = Object.keys(tree).sort();

  const gitMap = new Map(gitFiles.map((f) => [f.path, f.status]));

  // Determine active file from either URL (/view/...) or context (inline viewer)
  const fromUrl = parseViewPath(location.pathname);
  const fromContext = activeFile ? parseViewPath(`/view/${activeFile}`) : null;
  const active = fromUrl ?? fromContext;

  // Build the "current path" that FileButton uses for isActive matching
  // Either the real URL path or a synthetic /view/ path from context
  const currentPath = location.pathname.startsWith("/view/")
    ? location.pathname
    : activeFile
      ? `/view/${activeFile}`
      : location.pathname;

  return (
    <div className="text-sm">
      {projectNames.length === 0 && (
        <p className="text-xs px-1" style={{ color: "var(--text-muted)" }}>
          Loading...
        </p>
      )}
      {projectNames.map((project) => (
        <ProjectTreeSection
          key={project}
          name={project}
          node={tree[project]}
          currentPath={currentPath}
          gitMap={gitMap}
          onNavigate={navigate}
          shouldOpen={active?.project === project}
          activeSubfolder={active?.project === project ? active.subfolder : ""}
        />
      ))}
    </div>
  );
}
