import { useEffect, useMemo, useState, type ReactNode } from "react";
import "./FileTree.css";

export type TreeStatus = "M" | "A" | "D" | "R" | "?" | null;

export interface TreeFile {
  path: string;
  status?: TreeStatus;
  add?: number;
  del?: number;
  /** Review comments on this file; a badge shows when above zero. */
  comments?: number;
}

interface DirNode {
  name: string;
  path: string;
  dirs: DirNode[];
  files: { name: string; file: TreeFile }[];
  changed: boolean;
}

interface Props {
  files: TreeFile[];
  selected?: string;
  /** Opens this file's folders when nothing is selected, so the list doesn't start fully collapsed. */
  reveal?: string;
  onSelect: (path: string) => void;
  changedOnly?: boolean;
  "aria-label"?: string;
}

const isChanged = (f: TreeFile) => !!f.status;
// Byte-order tie-break keeps names equal under `base` (e.g. `A.ts`/`a.ts`) in a stable order.
const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) ||
  (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

// Maps while building: whole-repo trees reach tens of thousands of files.
function buildTree(files: TreeFile[]): DirNode {
  type Building = DirNode & { byName: Map<string, Building> };
  const mk = (name: string, path: string): Building => ({ name, path, dirs: [], files: [], changed: false, byName: new Map() });
  const root = mk("", "");
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      let child = node.byName.get(parts[i]);
      if (!child) {
        child = mk(parts[i], node.path ? `${node.path}/${parts[i]}` : parts[i]);
        node.byName.set(parts[i], child);
        node.dirs.push(child);
      }
      if (isChanged(file)) node.changed = true;
      node = child;
    }
    if (isChanged(file)) node.changed = true;
    node.files.push({ name: parts[parts.length - 1], file });
  }
  const finish = (n: Building): DirNode => ({
    name: n.name,
    path: n.path,
    dirs: (n.dirs as Building[]).map(finish).sort(byName),
    files: n.files.sort(byName),
    changed: n.changed,
  });
  return finish(root);
}

function ancestors(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

const commentsLabel = (n: number) => `${n} comment${n === 1 ? "" : "s"}`;

const STATUS_LABEL: Record<string, string> = { M: "modified", A: "added", D: "deleted", R: "renamed", "?": "untracked" };

export default function FileTree({ files, selected, reveal, onSelect, changedOnly = false, "aria-label": label = "Files" }: Props) {
  const tree = useMemo(() => buildTree(changedOnly ? files.filter(isChanged) : files), [files, changedOnly]);
  const shown = selected ?? reveal;
  const [open, setOpen] = useState<Set<string>>(() => new Set(shown ? ancestors(shown) : []));

  useEffect(() => {
    if (!shown) return;
    const need = ancestors(shown);
    setOpen((prev) => (need.every((p) => prev.has(p)) ? prev : new Set([...prev, ...need])));
  }, [shown]);

  const toggle = (path: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  // Only open folders recurse, so a collapsed repo renders its top level alone.
  const renderDir = (dir: DirNode, depth: number): ReactNode[] => {
    const indent = { paddingLeft: `${6 + depth * 12}px` };
    const rows: ReactNode[] = [];
    for (const d of dir.dirs) {
      const isOpen = open.has(d.path);
      rows.push(
        <button
          key={`d:${d.path}`}
          type="button"
          className="ft-row ft-dir"
          style={indent}
          data-testid={`ft-dir-${d.path}`}
          data-name={d.name}
          aria-expanded={isOpen}
          onClick={() => toggle(d.path)}
        >
          <span className="ft-chev" aria-hidden="true">
            {isOpen ? "▾" : "▸"}
          </span>
          <span className="ft-nm">{d.name}</span>
          {/* In changedOnly every folder holds changes, so the dot would say nothing. */}
          {!isOpen && d.changed && !changedOnly && (
            <>
              {" "}
              <span className="ft-dot" title="Contains changes">
                <span className="sr-only">contains changes</span>
              </span>
            </>
          )}
        </button>,
      );
      if (isOpen) rows.push(...renderDir(d, depth + 1));
    }
    for (const { name, file } of dir.files) {
      const st = file.status ?? null;
      const current = file.path === selected;
      rows.push(
        <button
          key={`f:${file.path}`}
          type="button"
          className={`ft-row ft-file${st ? "" : " unchanged"}`}
          style={indent}
          data-testid={`ft-file-${file.path}`}
          data-name={name}
          aria-current={current ? "true" : undefined}
          title={st ? `${file.path} (${STATUS_LABEL[st]})` : file.path}
          onClick={() => onSelect(file.path)}
        >
          <span className={`ft-st ft-st-${st === "?" ? "U" : (st ?? "none")}`}>{st === "?" ? "U" : st}</span>
          <span className="ft-nm">{name}</span>
          {(file.comments ?? 0) > 0 && (
            <span className="ft-cm" title={commentsLabel(file.comments!)}>
              <span aria-hidden="true">💬{file.comments}</span>
              <span className="sr-only">{commentsLabel(file.comments!)}</span>
            </span>
          )}
          {st && file.add != null && file.del != null && (
            <span className="ft-cnt">
              <span className="ft-add">+{file.add}</span> <span className="ft-del">−{file.del}</span>
            </span>
          )}
        </button>,
      );
    }
    return rows;
  };

  return (
    <nav className="ft" aria-label={label}>
      {renderDir(tree, 0)}
    </nav>
  );
}
