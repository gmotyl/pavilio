import type { ReviewComment } from "../../../server/lib/prs/provider";

export interface ReviewThread {
  anchor: { side: "old" | "new"; line: number };
  comments: ReviewComment[];
}

// Ids tie-break equal timestamps so thread order never depends on input order.
const byTime = (a: ReviewComment, b: ReviewComment) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id;

/**
 * path → ("new:14" | "old:14") → thread. Replies follow their root; orphans are dropped.
 * A reply's `replyTo` must name the thread's root comment, as GitHub guarantees;
 * a reply to a reply has no root here and is dropped like an orphan.
 */
export function groupThreads(comments: ReviewComment[]): Map<string, Map<string, ReviewThread>> {
  const roots = new Map(comments.filter((c) => c.replyTo === null).map((c) => [c.id, c]));
  const out = new Map<string, Map<string, ReviewThread>>();
  for (const c of comments) {
    const root = c.replyTo === null ? c : roots.get(c.replyTo);
    if (!root) continue;
    let file = out.get(root.path);
    if (!file) out.set(root.path, (file = new Map()));
    const key = `${root.side}:${root.line}`;
    let thread = file.get(key);
    if (!thread) file.set(key, (thread = { anchor: { side: root.side, line: root.line }, comments: [] }));
    thread.comments.push(c);
  }
  for (const file of out.values()) for (const t of file.values()) t.comments.sort(byTime);
  return out;
}

export function commentCount(threads: Map<string, ReviewThread> | undefined): number {
  let n = 0;
  for (const t of threads?.values() ?? []) n += t.comments.length;
  return n;
}
