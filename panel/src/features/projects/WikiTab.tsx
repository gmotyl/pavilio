import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import MarkdownRenderer from "../markdown/MarkdownRenderer";
import FileListSidebar, { type FileListSource } from "./FileListSidebar";
import FileRow from "./FileRow";
import ViewerActions from "./ViewerActions";
import { useFileListControls } from "./fileListControls";
import { usePeekTriggerProps } from "./peekTrigger";
import { relativeToWorkspace } from "./relativeToWorkspace";
import { useDocSpeech } from "./docSpeech";
import { useWorkspaceRoot } from "./useWorkspaceRoot";
import { useProjectWiki, useWikiPage, type WikiPageInfo, type WikiTree } from "./useProjectWiki";
import { clearLastSectionFile, writeLastSectionFile } from "../shell/lastPath";
import CopyIconButton from "../shell/CopyIconButton";
import { expandCommand } from "../terminal/expandCommand";
import { stripFrontmatter } from "../../lib/frontmatter";

/** Rows a page list shows before folding the rest behind "+ N more". */
const LIST_LIMIT = 5;
/** Source pages the "Built from" footer shows before "+ N more". */
const FOOTER_LIMIT = 3;

const ENTITY_KIND_LABELS: Record<string, string> = {
  person: "People",
  repository: "Repositories",
  service: "Services",
  organization: "Organizations",
  other: "Other",
};

/**
 * The page body under the tab's own header: frontmatter is shown as chips, and
 * a leading H1 repeating the title would print it twice.
 */
function pageBody(content: string, title: string): string {
  const body = stripFrontmatter(content);
  const h1 = /^\s*#[ \t]+(.+?)[ \t]*#*[ \t]*(?:\r?\n|$)/.exec(body);
  return h1 && h1[1].trim() === title ? body.slice(h1[0].length) : body;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const stem = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");

interface WikiFilter {
  query: string;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

function PageRow({ page, filter, count }: { page: WikiPageInfo; filter: WikiFilter; count?: string }) {
  return (
    <FileRow
      testId={`wiki-page-${page.path}`}
      label={page.title}
      // The description is the row's tooltip — the native hover every file row uses.
      title={page.description ?? undefined}
      dateLabel={count}
      selected={filter.selectedPath === page.path}
      onSelect={() => filter.onSelect(page.path)}
    />
  );
}

/** A page list with a "+ N more" fold. A selection in the fold, or a filter, unfolds it. */
function PageList({ id, pages, filter }: { id: string; pages: WikiPageInfo[]; filter: WikiFilter }) {
  const [expanded, setExpanded] = useState(false);
  const selectedIndex = pages.findIndex((p) => p.path === filter.selectedPath);
  const showAll = expanded || filter.query !== "" || selectedIndex >= LIST_LIMIT;
  const visible = showAll ? pages : pages.slice(0, LIST_LIMIT);
  const hidden = pages.length - visible.length;
  return (
    <>
      {visible.map((p) => (
        <PageRow key={p.path} page={p} filter={filter} />
      ))}
      {hidden > 0 && (
        <button
          data-testid={`wiki-more-${id}`}
          onClick={() => setExpanded(true)}
          className="px-2 py-1 text-[11px] rounded-md"
          style={{ color: "var(--text-muted)" }}
        >
          + {hidden} more
        </button>
      )}
    </>
  );
}

/** A collapsible subgroup inside a sidebar group: an entity kind, a repo, a source kind. */
function Subgroup({
  id,
  label,
  countLabel,
  pages,
  defaultOpen,
  filter,
}: {
  id: string;
  label: string;
  countLabel: string;
  pages: WikiPageInfo[];
  defaultOpen: boolean;
  filter: WikiFilter;
}) {
  const holdsSelection = pages.some((p) => p.path === filter.selectedPath);
  const [open, setOpen] = useState(() => defaultOpen || holdsSelection);
  // A selection moving into this subgroup (e.g. from the "Built from" footer) opens it,
  // so its row is visible; otherwise the user's own toggle stands. Adjusted during
  // render, not in an effect, so the row shows in the same commit as the selection.
  const [seenSelection, setSeenSelection] = useState(filter.selectedPath);
  if (seenSelection !== filter.selectedPath) {
    setSeenSelection(filter.selectedPath);
    if (holdsSelection) setOpen(true);
  }
  const isOpen = open || filter.query !== "";
  return (
    <div>
      <button
        data-testid={`wiki-sub-${id}`}
        aria-expanded={isOpen}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 w-full px-1 py-1 rounded-md text-xs transition-colors"
        style={{ color: "var(--text-secondary)" }}
      >
        {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span className="truncate">{label}</span>
        <span className="ml-auto text-[10px]" style={{ color: "var(--text-muted)" }}>
          {countLabel}
        </span>
      </button>
      {isOpen && (
        <div className="ml-3 pl-1" style={{ borderLeft: "1px solid var(--border-subtle)" }}>
          <PageList id={id} pages={pages} filter={filter} />
        </div>
      )}
    </div>
  );
}

const matches = (p: WikiPageInfo, q: string) =>
  p.title.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q);

/** The tree with only the pages matching `query` (title or description); counts follow. */
function filterTree(tree: WikiTree, query: string): WikiTree {
  const q = query.trim().toLowerCase();
  if (!q) return tree;
  const keep = (pages: WikiPageInfo[]) => pages.filter((p) => matches(p, q));
  const groups = <G extends { count: number; pages: WikiPageInfo[] }>(list: G[]) =>
    list
      .map((g) => ({ ...g, pages: keep(g.pages) }))
      .map((g) => ({ ...g, count: g.pages.length }))
      .filter((g) => g.count > 0);
  const sum = (list: { count: number }[]) => list.reduce((n, g) => n + g.count, 0);
  const kinds = groups(tree.entities.kinds);
  const repos = groups(tree.repos.repos);
  const sources = groups(tree.sources.kinds);
  const oq = tree.interaction.openQuestions && matches(tree.interaction.openQuestions, q)
    ? tree.interaction.openQuestions
    : null;
  const notes = keep(tree.interaction.notes);
  const questions = keep(tree.interaction.questions);
  const concepts = keep(tree.concepts.pages);
  return {
    ...tree,
    overview: tree.overview && matches(tree.overview, q) ? tree.overview : null,
    entities: { count: sum(kinds), kinds },
    concepts: { count: concepts.length, pages: concepts },
    repos: { count: sum(repos), repos },
    interaction: {
      ...tree.interaction,
      openQuestions: oq,
      notes,
      questions,
      count: (oq ? 1 : 0) + notes.length + questions.length,
    },
    sources: { count: sum(sources), kinds: sources },
    other: keep(tree.other),
  };
}

function CodeBadge() {
  return (
    <span
      data-testid="wiki-code-badge"
      className="ml-1 px-1 rounded text-[9px] font-mono uppercase tracking-wider"
      style={{ color: "var(--accent)", border: "1px solid var(--border-subtle)" }}
    >
      code
    </span>
  );
}

/** Sidebar groups in index order; empty groups are left out. */
function treeSources(tree: WikiTree, filter: WikiFilter): FileListSource[] {
  const out: FileListSource[] = [];
  if (tree.entities.count > 0) {
    out.push({
      id: "entities",
      label: "Entities",
      count: tree.entities.count,
      rows: tree.entities.kinds.map((k) => (
        <Subgroup
          key={k.kind}
          id={`entities:${k.kind}`}
          label={ENTITY_KIND_LABELS[k.kind] ?? k.kind}
          countLabel={String(k.count)}
          pages={k.pages}
          defaultOpen
          filter={filter}
        />
      )),
    });
  }
  if (tree.concepts.count > 0) {
    out.push({
      id: "concepts",
      label: "Concepts",
      count: tree.concepts.count,
      rows: <PageList id="concepts" pages={tree.concepts.pages} filter={filter} />,
    });
  }
  if (tree.repos.count > 0) {
    // The code fence the agents respect: every repo starts folded.
    out.push({
      id: "repos",
      label: "Repos",
      badge: <CodeBadge />,
      count: tree.repos.count,
      rows: tree.repos.repos.map((r) => (
        <Subgroup
          key={r.name}
          id={`repos:${r.name}`}
          label={r.name}
          countLabel={plural(r.count, "page")}
          pages={r.pages}
          defaultOpen={false}
          filter={filter}
        />
      )),
    });
  }
  const { interaction } = tree;
  if (interaction.count > 0) {
    out.push({
      id: "interaction",
      label: "Interaction",
      count: interaction.count,
      rows: (
        <>
          {interaction.openQuestions && (
            <PageRow
              page={interaction.openQuestions}
              filter={filter}
              count={
                interaction.openQuestionsCount === null
                  ? undefined
                  : String(interaction.openQuestionsCount)
              }
            />
          )}
          {interaction.notes.length > 0 && (
            <Subgroup
              id="interaction:notes"
              label="Notes"
              countLabel={String(interaction.notes.length)}
              pages={interaction.notes}
              defaultOpen={false}
              filter={filter}
            />
          )}
          {interaction.questions.length > 0 && (
            <Subgroup
              id="interaction:questions"
              label="Questions"
              countLabel={String(interaction.questions.length)}
              pages={interaction.questions}
              defaultOpen={false}
              filter={filter}
            />
          )}
        </>
      ),
    });
  }
  if (tree.sources.count > 0) {
    // Hundreds of pages: every kind starts folded.
    out.push({
      id: "sources",
      label: "Sources",
      count: tree.sources.count,
      rows: tree.sources.kinds.map((k) => (
        <Subgroup
          key={k.kind}
          id={`sources:${k.kind}`}
          label={k.kind}
          countLabel={String(k.count)}
          pages={k.pages}
          defaultOpen={false}
          filter={filter}
        />
      )),
    });
  }
  if (tree.other.length > 0) {
    out.push({
      id: "other",
      label: "Other",
      count: tree.other.length,
      rows: <PageList id="other" pages={tree.other} filter={filter} />,
    });
  }
  return out;
}

/** Every page of the (unfiltered) tree by path — titles for the footer, chips for the view. */
function pagesByPath(tree: WikiTree | null): Map<string, WikiPageInfo> {
  const map = new Map<string, WikiPageInfo>();
  if (!tree) return map;
  const add = (p: WikiPageInfo | null) => p && map.set(p.path, p);
  add(tree.overview);
  add(tree.interaction.openQuestions);
  for (const k of tree.entities.kinds) k.pages.forEach(add);
  tree.concepts.pages.forEach(add);
  for (const r of tree.repos.repos) r.pages.forEach(add);
  tree.interaction.notes.forEach(add);
  tree.interaction.questions.forEach(add);
  for (const k of tree.sources.kinds) k.pages.forEach(add);
  tree.other.forEach(add);
  return map;
}

function Chip({ testId, accent, children }: { testId: string; accent?: boolean; children: ReactNode }) {
  return (
    <span
      data-testid={testId}
      className="px-1.5 py-0.5 rounded text-[11px]"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        color: accent ? "var(--accent)" : "var(--text-secondary)",
      }}
    >
      {children}
    </span>
  );
}

function FooterLinks({
  testId,
  heading,
  paths,
  limit,
  pages,
  onOpen,
  empty,
}: {
  testId: string;
  heading: string;
  paths: string[];
  limit?: number;
  pages: Map<string, WikiPageInfo>;
  onOpen: (path: string) => void;
  empty: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = limit && !expanded ? paths.slice(0, limit) : paths;
  const hidden = paths.length - visible.length;
  return (
    <div data-testid={testId} className="min-w-0">
      <h3
        className="text-[11px] uppercase tracking-wider mb-1.5"
        style={{ color: "var(--text-muted)" }}
      >
        {heading}
      </h3>
      {paths.length === 0 && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {empty}
        </p>
      )}
      <div className="flex flex-col items-start gap-0.5">
        {visible.map((path) => (
          <button
            key={path}
            data-testid="wiki-footer-link"
            onClick={() => onOpen(path)}
            title={pages.get(path)?.description ?? undefined}
            className="text-xs text-left max-w-full truncate hover:underline"
            style={{ color: "var(--accent)" }}
          >
            {pages.get(path)?.title ?? stem(path)}
          </button>
        ))}
        {hidden > 0 && (
          <button
            data-testid={`${testId}-more`}
            onClick={() => setExpanded(true)}
            className="text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            + {hidden} more
          </button>
        )}
      </div>
    </div>
  );
}

function WikiPageView({
  file,
  path,
  info,
  pages,
  onOpen,
}: {
  file: string;
  path: string;
  info: WikiPageInfo | undefined;
  pages: Map<string, WikiPageInfo>;
  onOpen: (path: string) => void;
}) {
  const peekTrigger = usePeekTriggerProps();
  const workspaceRoot = useWorkspaceRoot();
  const { content, absolutePath, error } = useWikiPage(file);
  // The page's source as loaded — frontmatter and all, not `body`: the host's
  // `speakDocument` drops the frontmatter (`pageSpeechText`), and the repeated
  // title H1 `pageBody` hides is still the page's opening heading to a listener.
  const speech = useDocSpeech(absolutePath, content, absolutePath.endsWith(".md"));
  const title = info?.title ?? stem(path);
  const body = useMemo(() => (content === null ? null : pageBody(content, title)), [content, title]);

  return (
    <div data-testid="wiki-view" className="min-w-0 break-words">
      <div className="flex items-center gap-2 mb-2">
        <span
          {...peekTrigger}
          data-testid="wiki-crumbs"
          className="text-xs font-mono truncate flex-1 min-w-0 cursor-default"
          style={{ color: "var(--text-tertiary)" }}
        >
          {path.replace(/\.md$/, "").split("/").join(" / ")}
        </span>
        {absolutePath && (
          <ViewerActions
            absolutePath={absolutePath}
            relativePath={workspaceRoot ? relativeToWorkspace(absolutePath, workspaceRoot) : null}
            content={content}
            speech={speech}
          />
        )}
      </div>
      <h2 data-testid="wiki-title" className="text-xl font-semibold mb-2">
        {title}
      </h2>
      <div data-testid="wiki-chips" className="flex flex-wrap gap-1.5 mb-4">
        {info?.type && (
          <Chip testId="wiki-chip-type" accent>
            {info.type}
          </Chip>
        )}
        {info && <Chip testId="wiki-chip-sources">{plural(info.sourceCount, "source")}</Chip>}
        {info?.updated && <Chip testId="wiki-chip-updated">updated {info.updated}</Chip>}
        {info?.created && <Chip testId="wiki-chip-created">created {info.created}</Chip>}
      </div>
      {error && (
        <p className="text-sm" style={{ color: "var(--red)" }}>
          Failed to load page: {error}
        </p>
      )}
      {!error && body === null && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Loading…
        </p>
      )}
      {body !== null && (
        <div data-testid="wiki-body">
          <MarkdownRenderer content={body} basePath={file} />
        </div>
      )}
      {info && (
        <div
          key={path}
          data-testid="wiki-footer"
          className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6 pt-4"
          style={{ borderTop: "1px solid var(--border-subtle)" }}
        >
          <FooterLinks
            testId="wiki-linked-from"
            heading="Linked from"
            paths={info.backlinks}
            pages={pages}
            onOpen={onOpen}
            empty="No pages link here yet."
          />
          <FooterLinks
            testId="wiki-built-from"
            heading="Built from"
            paths={info.sources}
            limit={FOOTER_LIMIT}
            pages={pages}
            onOpen={onOpen}
            empty="No source pages."
          />
        </div>
      )}
    </div>
  );
}

/** The skill the ask hint names; the only one its expansion needs to know. */
const WIKI_SKILL = "pavilio-wiki";

/**
 * The one-line hint at the top of the tab: the command to ask this wiki from a
 * terminal. The copy button writes the composer's own expansion of it, so the
 * pasted text points at the skill file instead of a slash command.
 */
function AskHint({ projectName }: { projectName: string }) {
  const command = `/${WIKI_SKILL} ${projectName} "…"`;
  const expanded = useMemo(() => expandCommand(command, new Set([WIKI_SKILL])), [command]);
  return (
    <div
      data-testid="wiki-ask-hint"
      className="flex items-center gap-1.5 mb-2 text-xs min-w-0"
      style={{ color: "var(--text-muted)" }}
    >
      <span className="truncate">
        Ask this wiki: <code className="font-mono">{command}</code>
      </span>
      <CopyIconButton value={expanded} label="Copy the ask instruction" data-testid="wiki-ask-copy" />
    </div>
  );
}

interface Props {
  projectName: string;
}

/**
 * The project's LLM wiki: the index-driven tree on the shared file-list
 * sidebar, the open page in the markdown viewer. Read-only. The open page is
 * `?file=<project>/wiki/...md`, remembered per tab like the other file lists.
 */
export default function WikiTab({ projectName }: Props) {
  const { data, loading, error, refresh } = useProjectWiki(projectName);
  const [searchParams, setSearchParams] = useSearchParams();
  const file = searchParams.get("file");
  const prefix = `${projectName}/`;
  const selectedPath = file?.startsWith(prefix) ? file.slice(prefix.length) : null;

  const setFile = useCallback(
    (next: string | null) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next) p.set("file", next);
          else p.delete("file");
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const openPage = useCallback((path: string) => setFile(`${prefix}${path}`), [prefix, setFile]);

  // Remember the open page so the tab link restores it on return.
  useEffect(() => {
    if (!projectName) return;
    if (file) writeLastSectionFile(projectName, "wiki", file);
    else clearLastSectionFile(projectName, "wiki");
  }, [projectName, file]);

  const controls = useFileListControls({ sortable: false, placeholder: "Filter pages…" });
  const query = controls.debouncedQuery.trim().toLowerCase();
  const pages = useMemo(() => pagesByPath(data), [data]);
  const filtered = useMemo(() => (data ? filterTree(data, query) : null), [data, query]);

  if (loading && !data) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Loading wiki…
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-sm" style={{ color: "var(--red)" }}>
        Failed to load wiki: {error}
      </p>
    );
  }
  if (!filtered) return null;

  const filter: WikiFilter = { query, selectedPath, onSelect: openPage };

  return (
    <>
      <AskHint projectName={projectName} />
      <FileListSidebar
        testId="wiki-tab"
        title="Wiki"
        icon={<BookOpen size={16} style={{ color: "var(--accent)" }} />}
        sources={treeSources(filtered, filter)}
        controls={controls.controlsBar}
        aboveList={filtered.overview ? <PageRow page={filtered.overview} filter={filter} /> : null}
        onRefresh={refresh}
        detail={
          file && selectedPath ? (
            <WikiPageView
              key={file}
              file={file}
              path={selectedPath}
              info={pages.get(selectedPath)}
              pages={pages}
              onOpen={openPage}
            />
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Select a page to view.
            </p>
          )
        }
      />
    </>
  );
}
