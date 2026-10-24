import { docSpeechKey } from "../speech/docKey";
import { relativeToWorkspace } from "./relativeToWorkspace";
import { useProjectsDir } from "./useWorkspaceRoot";

/** What a viewer hands `ViewerActions` to offer Play: the page's key and its source. */
export interface DocSpeech {
  key: string;
  text: string;
}

/**
 * The speech key of the file at `absolutePath`: its path relative to the
 * PROJECTS directory — not the workspace root copy-path uses — so the key's
 * first segment is the project (`doc:pavilio/wiki/x.md`) and the page speaks in
 * that project's voice. A file outside the projects directory comes out as a
 * `..` path (`doc:../AGENTS.md`), which names no project: the default voice.
 */
export function docSpeechKeyFor(absolutePath: string, projectsDir: string): string {
  // `relativeToWorkspace` is POSIX `path.relative` with backslashes normalised;
  // nothing in it is specific to the workspace root.
  return docSpeechKey(relativeToWorkspace(absolutePath, projectsDir));
}

/**
 * The `speech` prop every markdown surface passes its toolbar. Undefined — no
 * Play — for a file that is not markdown, before the file's path is known (a
 * surface switching files passes null until the new read resolves, so the
 * previous page's key — and its run — does not outlive the switch), and
 * until the server has reported the projects directory (a key built without it
 * would name the wrong project). `text` is the markdown source as loaded, or
 * empty while it is loading, which leaves Play disabled.
 */
export function useDocSpeech(
  absolutePath: string | null | undefined,
  text: string | null | undefined,
  isMarkdown: boolean,
): DocSpeech | undefined {
  const projectsDir = useProjectsDir();
  if (!isMarkdown || !absolutePath || projectsDir === null) return undefined;
  return { key: docSpeechKeyFor(absolutePath, projectsDir), text: text ?? "" };
}
