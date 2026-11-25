import { createContext, useContext, useSyncExternalStore } from "react";
import { numberStoryDiff } from "./storyDiff";
import { noteTarget, type NoteTarget } from "./noteTarget";

export interface HastLike {
  type?: string;
  value?: string;
  children?: HastLike[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}

/** Text content of a hast node — the fallback when there is no Markdown source to cut. */
export function hastText(node: HastLike | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(hastText).join("");
}

/** A hast node as the story-note binding reads and marks it. */
export interface StoryHast {
  type?: string;
  value?: string;
  tagName?: string;
  properties?: { className?: unknown };
  children?: StoryHast[];
  data?: { storyBlock?: number; storyNote?: StoryNote; storyNoteLabel?: boolean };
}

/** A line note bound to a story block: the block's id within the document and the rows its label names. */
export interface StoryNote {
  block: number;
  label: string;
  target: NoteTarget;
}

/** The first child that is not whitespace-only text. */
function firstContent(node: StoryHast): StoryHast | undefined {
  return (node.children ?? []).find((c) => !(c.type === "text" && !(c.value ?? "").trim()));
}

/** The `code` of a `pre` holding a numbered story `diff` block, else null. */
function storyCode(pre: StoryHast): StoryHast | null {
  if (pre.tagName !== "pre") return null;
  const code = (pre.children ?? []).find((c) => c.type === "element");
  if (code?.tagName !== "code") return null;
  const cls = code.properties?.className;
  const classes = Array.isArray(cls) ? cls.map(String) : typeof cls === "string" ? cls.split(/\s+/) : [];
  if (!classes.includes("language-diff")) return null;
  return numberStoryDiff(hastText(code)) ? code : null;
}

/** Mark each item of a bound note list whose content starts with a bold line label, and that label. */
function bindNotes(ol: StoryHast, block: number): void {
  for (const li of ol.children ?? []) {
    if (li.tagName !== "li") continue;
    let first = firstContent(li);
    // A loose list wraps the item's text in a paragraph.
    if (first?.tagName === "p") first = firstContent(first);
    if (first?.type !== "element" || first.tagName !== "strong") continue;
    const label = hastText(first);
    const target = noteTarget(label);
    if (!target) continue;
    li.data = { ...li.data, storyNote: { block, label: label.trim(), target } };
    first.data = { ...first.data, storyNoteLabel: true };
  }
}

/**
 * Rehype plugin, run after rehype-raw so the nodes it marks are the ones the components get: gives each
 * numbered story `diff` block an id (on its `code`) and binds the ordered list directly after it — only
 * whitespace between — to that id. The marks live in hast `data`, which no authored HTML can set.
 */
export function rehypeStoryNotes() {
  return (tree: StoryHast) => {
    let nextBlock = 0;
    const walk = (parent: StoryHast) => {
      let previous: number | null = null;
      for (const child of parent.children ?? []) {
        if (child.type === "text" && !(child.value ?? "").trim()) continue;
        if (child.type !== "element") {
          previous = null;
          continue;
        }
        if (previous !== null && child.tagName === "ol") bindNotes(child, previous);
        const code = storyCode(child);
        if (code) {
          code.data = { ...code.data, storyBlock: nextBlock };
          previous = nextBlock++;
        } else {
          previous = null;
        }
        walk(child);
      }
    };
    walk(tree);
  };
}

/** The note whose rows are lit: at most one in the document at a time. */
export interface NoteHit {
  block: number;
  target: NoteTarget;
}

/**
 * Which note is lit, outside React state: a hover re-renders only the story blocks that subscribe
 * to it, not the whole document (re-parsing the Markdown on every pointer move).
 */
export function createNoteHitStore() {
  let hit: NoteHit | null = null;
  const listeners = new Set<() => void>();
  const set = (next: NoteHit | null) => {
    if (next === hit) return;
    hit = next;
    listeners.forEach((l) => l());
  };
  return {
    get: () => hit,
    set,
    /** Clears only `mine`, so leaving one note does not unlight another that has since taken over. */
    clear: (mine: NoteHit) => {
      if (hit === mine) set(null);
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type NoteHitStore = ReturnType<typeof createNoteHitStore>;

export const NoteHitContext = createContext<NoteHitStore | null>(null);

export const NO_STORE: NoteHitStore = createNoteHitStore();

/** The lit target in this block, or null. */
export function useBlockHit(block: number | undefined): NoteTarget | null {
  const store = useContext(NoteHitContext) ?? NO_STORE;
  return useSyncExternalStore(store.subscribe, () => {
    const hit = store.get();
    return hit && block !== undefined && hit.block === block ? hit.target : null;
  });
}
