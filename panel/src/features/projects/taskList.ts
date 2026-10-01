export interface TaskListStatus {
  /** The change directory's id, when the file qualifies. */
  changeId: string;
  total: number;
  remaining: number;
}

// `changes/<id>/tasks.md` with the file directly inside the change directory.
const CHANGE_TASKS = /(?:^|\/)changes\/([^/]+)\/tasks\.md$/;
// A list-item checkbox at any indent: `-`, `*` or `+` bullet, then `[ ]`, `[x]` or `[X]`,
// followed by whitespace or the end of the line (GFM task-list syntax).
const CHECKBOX = /^[ \t]*[-*+][ \t]+\[([ xX])\](?:[ \t]|$)/;
const FENCE = /^[ \t]*(`{3,}|~{3,})/;

/** `null` unless: basename is `tasks.md`, the path contains `changes/<id>/`, it is NOT under
 *  `changes/archive/`, and it holds at least one checkbox. A list with every box checked is
 *  a status too, with `remaining: 0` — a finished change, not a runnable one.
 *
 *  Checkboxes inside fenced code blocks are examples, not work, and are not counted. */
export function taskListStatus(path: string, content: string): TaskListStatus | null {
  if (/(?:^|\/)changes\/archive\//.test(path)) return null;
  const match = CHANGE_TASKS.exec(path);
  if (!match) return null;
  const changeId = match[1];

  let total = 0;
  let remaining = 0;
  let fence: string | null = null;
  for (const line of content.split(/\r?\n/)) {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const box = CHECKBOX.exec(line);
    if (!box) continue;
    total++;
    if (box[1] === " ") remaining++;
  }

  if (total === 0) return null;
  return { changeId, total, remaining };
}
