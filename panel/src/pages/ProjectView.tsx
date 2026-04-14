import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { FileText, ExternalLink, Copy, Check, ArrowLeft, GitFork, Search, X } from "lucide-react";
import MarkdownRenderer from "../components/MarkdownRenderer";
import ImageDropZone from "../components/ImageDropZone";
import GitChanges from "../components/GitChanges";
import GrepResultRow from "../components/GrepResultRow";
import { useFileIndex } from "../hooks/useFileIndex";
import { useProjects } from "../hooks/useProjects";
import { useWebSocket } from "../hooks/useWebSocket";
import { useActiveFile } from "../hooks/useActiveFile";
import type { GrepResult } from "../types/grep";

export default function ProjectView() {
  const { name, section } = useParams<{ name: string; section?: string }>();
  const [content, setContent] = useState<string | null>(null);
  const [absolutePath, setAbsolutePath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const files = useFileIndex();
  const projects = useProjects();
  const { lastMessage } = useWebSocket();
  const { setActiveFile } = useActiveFile();

  const navTo = useNavigate();
  const project = projects.find((p) => p.name === name);
  const hasRepos = (project?.repos?.length ?? 0) > 0;

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GrepResult[]>([]);
  const [searchActive, setSearchActive] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchSelectedIdx, setSearchSelectedIdx] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setSearchQuery(""); setSearchResults([]); setSearchActive(false); }, [name]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f" && name) {
        e.preventDefault();
        setSearchActive(true);
        setTimeout(() => searchInputRef.current?.focus(), 10);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [name]);

  useEffect(() => {
    if (searchQuery.length < 2) { setSearchResults([]); return; }
    setSearchLoading(true);
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/grep?q=${encodeURIComponent(searchQuery)}&project=${encodeURIComponent(name!)}`, { signal: abort.signal });
        if (res.ok) setSearchResults(await res.json());
        else setSearchResults([]);
      } catch (e: any) {
        if (e.name !== "AbortError") setSearchResults([]);
      }
      finally { setSearchLoading(false); }
    }, 200);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [searchQuery, name]);

  useEffect(() => { setSearchSelectedIdx(0); }, [searchQuery]);

  const openSearchResult = useCallback((path: string) => {
    navTo(`/view/${path}`);
  }, [navTo]);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { setSearchActive(false); setSearchQuery(""); setSearchResults([]); return; }
    const count = searchResults.length;
    if (!count) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSearchSelectedIdx((i) => (i + 1) % count); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSearchSelectedIdx((i) => (i - 1 + count) % count); }
    else if (e.key === "Enter") {
      const r = searchResults[searchSelectedIdx];
      if (r) openSearchResult(r.relativePath);
    }
  }, [searchResults, searchSelectedIdx, openSearchResult]);

  const [selectedFile, setSelectedFileState] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [fileAbsPath, setFileAbsPath] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const setSelectedFile = (path: string | null) => {
    setSelectedFileState(path);
    setActiveFile(path);
  };

  useEffect(() => { setSelectedFile(null); }, [name, section]);

  useEffect(() => {
    if (!name || section) return;
    setContent(null);
    setError(null);
    fetch(`/api/files/read/${name}/PROJECT.md`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Not found (${res.status})`);
        const data = await res.json();
        setContent(data.content);
        setAbsolutePath(data.absolutePath || "");
      })
      .catch((err) => setError(err.message));
  }, [name, section]);

  useEffect(() => {
    if (!selectedFile) return;
    setFileLoading(true);
    fetch(`/api/files/read/${selectedFile}`)
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          setFileContent(data.content);
          setFileAbsPath(data.absolutePath || "");
        }
      })
      .finally(() => setFileLoading(false));
  }, [selectedFile]);

  useEffect(() => {
    if (!selectedFile || lastMessage?.type !== "file-change") return;
    const changedPath = lastMessage.path as string;
    if (changedPath?.includes(selectedFile)) {
      fetch(`/api/files/read/${selectedFile}`)
        .then(async (res) => { if (res.ok) setFileContent((await res.json()).content); });
    }
  }, [lastMessage, selectedFile]);

  const sectionFiles = section && section !== "repos"
    ? files
        .filter((f) => {
          if (f.project !== name || f.relativePath.split("/")[1] !== section) {
            return false;
          }

          if (section === "notes") {
            return f.relativePath.endsWith(".md");
          }

          return true;
        })
        .sort((a, b) => b.modified - a.modified)
    : [];

  const sections = ["plans", "notes", "memo", "progress", "qa"];
  if (hasRepos) sections.push("repos");

  const openInVSCode = (path: string) => window.open(`vscode://file/${path}`, "_self");

  const copyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const isMarkdown = (p: string) => p.endsWith(".md");
  const isJson = (p: string) => p.endsWith(".json");

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-2xl font-semibold mb-4 capitalize">{name}</h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 text-sm">
        {[{ label: "Overview", to: `/project/${name}`, active: !section }, ...sections.map((s) => ({ label: s, to: `/project/${name}/${s}`, active: section === s }))].map(
          (tab) => (
            <Link
              key={tab.label}
              to={tab.to}
              className="px-3 py-1.5 rounded-md capitalize transition-colors"
              style={{
                background: tab.active ? "var(--bg-active)" : "transparent",
                color: tab.active ? "var(--text-primary)" : "var(--text-tertiary)",
              }}
              onMouseEnter={(e) => { if (!tab.active) e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { if (!tab.active) e.currentTarget.style.background = tab.active ? "var(--bg-active)" : "transparent"; }}
            >
              {tab.label}
            </Link>
          )
        )}
        {/* Search toggle */}
        <button
          onClick={() => { setSearchActive((a) => !a); setTimeout(() => searchInputRef.current?.focus(), 10); }}
          className="ml-auto px-2 py-1.5 rounded-md transition-colors"
          style={{ color: searchActive ? "var(--accent)" : "var(--text-tertiary)" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          title="Search in project (Cmd+F)"
        >
          <Search size={14} />
        </button>
      </div>

      {/* Project search bar */}
      {searchActive && (
        <div className="mb-4">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "var(--bg-base)", border: "1px solid var(--border-subtle)" }}>
            <Search size={14} style={{ color: "var(--accent)" }} />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={`Search in ${name}...`}
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: "var(--text-primary)" }}
              spellCheck={false}
              autoComplete="off"
            />
            {searchQuery && (
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{searchResults.length} results</span>
            )}
            <button
              onClick={() => { setSearchActive(false); setSearchQuery(""); setSearchResults([]); }}
              className="text-[11px] px-1.5 py-0.5 rounded"
              style={{ color: "var(--text-muted)" }}
            >
              ESC
            </button>
          </div>
          {searchLoading && <div className="mt-2 text-xs animate-pulse" style={{ color: "var(--text-tertiary)" }}>Searching...</div>}
          {!searchLoading && searchQuery.length >= 2 && searchResults.length > 0 && (
            <div className="mt-2 rounded-lg overflow-hidden" style={{ border: "1px solid var(--border-subtle)", maxHeight: "50vh", overflowY: "auto" }}>
              {searchResults.map((result, i) => (
                <GrepResultRow
                  key={result.relativePath}
                  result={result}
                  query={searchQuery}
                  isSelected={i === searchSelectedIdx}
                  onClick={() => openSearchResult(result.relativePath)}
                  onMouseEnter={() => setSearchSelectedIdx(i)}
                />
              ))}
            </div>
          )}
          {!searchLoading && searchQuery.length >= 2 && searchResults.length === 0 && (
            <div className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>No matches found</div>
          )}
        </div>
      )}

      {/* Repos tab */}
      {section === "repos" && project?.repos && (
        <div className="space-y-6">
          {project.repos.map((repo) => (
            <div key={repo.path} className="rounded-lg p-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
              <div className="flex items-center gap-2 mb-3">
                <GitFork size={14} style={{ color: "var(--accent)" }} />
                <span className="text-sm font-semibold">{repo.name}</span>
                <span className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>{repo.path}</span>
              </div>
              <GitChanges repo={repo.path} showCommit />
            </div>
          ))}
        </div>
      )}

      {/* File section listing */}
      {section && section !== "repos" && !selectedFile && (
        <div>
          {/* Current Plans banner */}
          {section === "plans" && project?.currentPlans && project.currentPlans.length > 0 && (
            <div className="mb-4 rounded-lg p-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--accent)", borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)" }}>
              <h3 className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--accent)" }}>
                Active Plans
              </h3>
              <div className="space-y-0.5">
                {project.currentPlans.map((planFile) => {
                  const relativePath = `${name}/plans/${planFile}`;
                  const label = planFile.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/-/g, " ");
                  return (
                    <div key={planFile} className="flex items-center gap-1">
                      <button
                        onClick={() => setSelectedFile(relativePath)}
                        className="flex items-center gap-3 flex-1 px-3 py-1.5 rounded-md text-left transition-colors"
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <FileText size={14} className="shrink-0" style={{ color: "var(--accent)" }} />
                        <span className="text-sm truncate flex-1 capitalize" style={{ color: "var(--text-primary)" }}>{label}</span>
                      </button>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          await fetch(`/api/projects/${name}/plans/current/${encodeURIComponent(planFile)}`, { method: "DELETE" });
                        }}
                        className="shrink-0 p-1 rounded transition-colors"
                        style={{ color: "var(--text-muted)" }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--red)"; e.currentTarget.style.background = "var(--red-dim)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "transparent"; }}
                        title="Close plan (remove from active)"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {section === "qa" ? (
            (() => {
              const runs = sectionFiles
                .filter((f) => f.relativePath.endsWith("/run.md"))
                .map((f) => {
                  const parts = f.relativePath.split("/");
                  const folderName = parts[parts.length - 2];
                  return { file: f, folderName };
                })
                .sort((a, b) => b.folderName.localeCompare(a.folderName));

              return (
                <>
                  <h2 className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--text-tertiary)" }}>
                    QA Runs ({runs.length})
                  </h2>
                  {runs.length === 0 ? (
                    <p className="text-sm" style={{ color: "var(--text-muted)" }}>No QA runs found.</p>
                  ) : (
                    <div className="space-y-0.5">
                      {runs.map(({ file, folderName }) => (
                        <button
                          key={file.relativePath}
                          onClick={() => setSelectedFile(file.relativePath)}
                          className="flex items-center gap-3 w-full px-3 py-2 rounded-md text-left transition-colors"
                          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                        >
                          <FileText size={14} className="shrink-0" style={{ color: "var(--text-tertiary)" }} />
                          <span className="text-sm truncate flex-1 font-mono" style={{ color: "var(--text-secondary)" }}>{folderName}</span>
                          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                            {new Date(file.modified).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              );
            })()
          ) : (
            <>
              <h2 className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--text-tertiary)" }}>
                {section} ({sectionFiles.length} files)
              </h2>
              {sectionFiles.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>No files in this section.</p>
              ) : (
                <div className="space-y-0.5">
                  {sectionFiles.map((file) => {
                    const fileName = file.relativePath.split("/").pop() ?? file.relativePath;
                    const date = new Date(file.modified).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                    return (
                      <button
                        key={file.relativePath}
                        onClick={() => setSelectedFile(file.relativePath)}
                        className="flex items-center gap-3 w-full px-3 py-2 rounded-md text-left transition-colors"
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <FileText size={14} className="shrink-0" style={{ color: "var(--text-tertiary)" }} />
                        <span className="text-sm truncate flex-1" style={{ color: "var(--text-secondary)" }}>{fileName}</span>
                        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{date}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Inline file viewer */}
      {section && section !== "repos" && selectedFile && (
        <div>
          <div className="flex items-center gap-2 mb-4 pb-3" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
            <button
              onClick={() => setSelectedFile(null)}
              className="flex items-center gap-1.5 text-sm px-2 py-1 rounded-md transition-colors"
              style={{ color: "var(--text-secondary)" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-primary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; }}
            >
              <ArrowLeft size={14} />
              Back
            </button>
            <span className="text-sm font-mono truncate flex-1" style={{ color: "var(--text-tertiary)" }}>{selectedFile.split("/").pop()}</span>
            {fileAbsPath && (
              <>
                <button onClick={() => openInVSCode(fileAbsPath)} className="flex items-center gap-1.5 text-sm px-2 py-1 rounded-md transition-colors" style={{ color: "var(--text-secondary)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-primary)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; }}>
                  <ExternalLink className="w-3.5 h-3.5" /> VS Code
                </button>
                <button onClick={() => copyPath(fileAbsPath)} className="flex items-center gap-1.5 text-sm px-2 py-1 rounded-md transition-colors"
                  style={{ color: copied ? "var(--green)" : "var(--text-secondary)" }}>
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? "Copied" : "Path"}
                </button>
              </>
            )}
          </div>
          {fileLoading ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading...</p>
          ) : (
            <ImageDropZone targetMarkdown={selectedFile}>
              {isMarkdown(selectedFile) ? <MarkdownRenderer content={fileContent} basePath={selectedFile} />
                : isJson(selectedFile) ? (
                  <pre className="text-sm font-mono p-4 rounded-lg overflow-auto" style={{ background: "var(--bg-surface)" }}>
                    {(() => { try { return JSON.stringify(JSON.parse(fileContent), null, 2); } catch { return fileContent; } })()}
                  </pre>
                ) : <pre className="text-sm font-mono whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>{fileContent}</pre>}
            </ImageDropZone>
          )}
        </div>
      )}

      {/* Overview */}
      {!section && (
        <>
          {absolutePath && (
            <div className="flex gap-2 mb-4">
              <button onClick={() => openInVSCode(absolutePath)} className="flex items-center gap-1.5 text-sm px-2 py-1 rounded-md transition-colors" style={{ color: "var(--text-secondary)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-primary)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; }}>
                <ExternalLink className="w-3.5 h-3.5" /> Open in VS Code
              </button>
            </div>
          )}
          {error && <p className="text-sm" style={{ color: "var(--red)" }}>Failed to load PROJECT.md: {error}</p>}
          {!error && content === null && <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading...</p>}
          {content !== null && <MarkdownRenderer content={content} basePath={`${name}/PROJECT.md`} />}
        </>
      )}
    </div>
  );
}
