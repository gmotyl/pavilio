/**
 * The rows a story line note is about, from its bold label (see
 * `skills/pavilio-pr-explain/SKILL.md`): `L12` and `L27–33` (en dash or hyphen)
 * name head lines, the gutter numbers; `base L16` names base lines, which only
 * context and removed rows carry (`StoryDiffLine.base`).
 */
export interface NoteTarget {
  side: "head" | "base";
  from: number;
  to: number;
}

const LABEL = /^(base )?L(\d+)(?:[–-](\d+))?$/;

/** The label's target, or null when the text is not a line label (or its range runs backwards). */
export function noteTarget(label: string): NoteTarget | null {
  const match = LABEL.exec(label.trim());
  if (!match) return null;
  const from = Number(match[2]);
  const to = match[3] === undefined ? from : Number(match[3]);
  if (to < from) return null;
  return { side: match[1] ? "base" : "head", from, to };
}

/** Whether a row with these numbers is one the target names. */
export function noteHits(target: NoteTarget, row: { number: number | null; base: number | null }): boolean {
  const n = target.side === "head" ? row.number : row.base;
  return n !== null && n >= target.from && n <= target.to;
}
