import "./Code.css";

export type OutlineKind = "function" | "class" | "interface" | "type" | "enum" | "const";

export interface OutlineItem {
  name: string;
  kind: OutlineKind;
  line: number;
}

const ID = "([A-Za-z_$][\\w$]*)";
const LEAD = "^(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?";
// Order matters: `const enum` must hit enum before const.
const RULES: [OutlineKind, RegExp][] = [
  ["function", new RegExp(`${LEAD}(?:async\\s+)?function\\s*\\*?\\s*${ID}`)],
  ["class", new RegExp(`${LEAD}(?:abstract\\s+)?class\\s+${ID}`)],
  ["interface", new RegExp(`${LEAD}interface\\s+${ID}`)],
  ["type", new RegExp(`${LEAD}type\\s+${ID}\\s*[=<]`)],
  ["enum", new RegExp(`${LEAD}(?:const\\s+)?enum\\s+${ID}`)],
  ["const", new RegExp(`${LEAD}(?:const|let|var)\\s+${ID}`)],
];

const ICON: Record<OutlineKind, string> = { function: "ƒ", class: "C", interface: "I", type: "T", enum: "E", const: "c" };

export const OUTLINE_FILE = /\.(?:[cm]?[jt]sx?)$/i;

/** Top-level declarations by a line scan: only unindented lines count, so nested ones are skipped. */
export function outlineOf(content: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  content.split("\n").forEach((text, i) => {
    if (!text || /^\s/.test(text)) return;
    for (const [kind, re] of RULES) {
      const m = re.exec(text);
      if (m) {
        items.push({ name: m[1], kind, line: i + 1 });
        return;
      }
    }
  });
  return items;
}

interface Props {
  /** Null when the open file has no outline (not a script, or nothing open). */
  items: OutlineItem[] | null;
  onJump: (line: number) => void;
}

export default function Outline({ items, onJump }: Props) {
  return (
    <aside className="cv-rail" aria-label="Outline" data-testid="code-outline">
      <h4>Outline</h4>
      {items === null ? (
        <p className="cv-rail-empty">No outline for this file.</p>
      ) : items.length === 0 ? (
        <p className="cv-rail-empty">No top-level declarations.</p>
      ) : (
        items.map((it) => (
          <button
            key={`${it.line}:${it.name}`}
            type="button"
            data-testid={`code-outline-${it.line}`}
            title={`${it.kind} ${it.name}`}
            onClick={() => onJump(it.line)}
          >
            <span className={`cv-ol-ic cv-ol-${it.kind}`} aria-hidden="true">
              {ICON[it.kind]}
            </span>
            <span className="cv-ol-nm">{it.name}</span>
            <span className="cv-ol-ln">{it.line}</span>
          </button>
        ))
      )}
    </aside>
  );
}
