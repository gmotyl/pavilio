import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ExternalLink,
  Copy,
  ClipboardCopy,
  Check,
  FileSymlink,
  Link,
  Play,
  Square,
} from "lucide-react";
import { copyToClipboard } from "../../lib/clipboard";
import { DocumentSpeechBar } from "../speech/DocumentSpeechBar";
import { usePageSpeech } from "../speech/SpeechHostProvider";
import { pageHasSpeech } from "../speech/pageText";
import { openInVSCode } from "../shell/vscode";
import type { DocSpeech } from "./docSpeech";

const BUTTON_CLASS =
  "flex items-center gap-1.5 text-sm px-2 py-1 rounded-md transition-colors";

/** Which button, if any, is currently showing its "Copied" confirmation. */
type Feedback = "path" | "link" | "absolute" | "content" | null;

/** Play's label on a page with nothing to say — the cell button's words. */
const NOTHING_TO_SPEAK = "Nothing to speak yet";

/** Viewer toolbar actions: the buttons above an open file that operate on it. */
export function ViewerActions({
  absolutePath,
  content,
  relativePath,
  copyLinkText,
  testIdPrefix = "file-viewer",
  speech,
}: {
  /** The open file on disk. VS Code and copy-absolute take it. */
  absolutePath: string;
  /** Open file's source. Null/undefined/empty means nothing to copy — the button is disabled. */
  content?: string | null;
  /**
   * What copy-path puts on the clipboard: the file's path relative to the
   * workspace root (`relativeToWorkspace`), e.g. `projects/metro/notes/a.md`, or
   * a `../` path for a linked repo outside it. Required, so every call site has
   * to derive it; `null` means it is not known yet (the workspace root is still
   * loading) and disables the button. The absolute path never stands in for it
   * — that has its own button.
   */
  relativePath: string | null;
  /**
   * What Copy link puts on the clipboard: a markdown link to the file's panel
   * route, built by the caller. Only the mockup viewer passes it; left out
   * (`undefined`), no Copy link button renders. `null` means the link cannot
   * be built yet (the workspace root is still loading) and disables the button.
   */
  copyLinkText?: string | null;
  /**
   * Stem of the buttons' `data-testid`s. It exists so the standalone `/view/*`
   * viewer can compose this toolbar without renaming the `markdown-viewer-*`
   * hooks it already published; every other call site takes the default.
   */
  testIdPrefix?: string;
  /**
   * The open page as a speech source: its key (`docSpeechKeyFor`) and its
   * markdown source as loaded. Passed only for a markdown file (`useDocSpeech`);
   * left out — the mockup frame, any other file — no Play renders and the
   * toolbar never reaches for the speech host.
   */
  speech?: DocSpeech;
}) {
  const [copied, setCopied] = useState<Feedback>(null);
  // A single revert timer for the whole toolbar: only one button shows feedback
  // at a time, so a new copy restarts the countdown rather than racing the old
  // one. Held in a ref so it survives re-renders and can be cleared on unmount.
  const revertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Three call sites mount this toolbar, and they do not agree on when it goes
  // away. `FileViewer` and `PlansTab` render it inline, so every file switch and
  // tab change unmounts it and a pending timer would otherwise outlive the
  // component. The standalone `/view/*` viewer does NOT: it hands the toolbar to
  // the breadcrumb slot, where a file switch re-registers the same element type
  // in the same position, so React re-renders it in place — state and this timer
  // survive the switch, and the unmount only comes when the viewer leaves the
  // screen. The cleanup still covers that last exit.
  useEffect(
    () => () => {
      if (revertTimer.current !== null) clearTimeout(revertTimer.current);
    },
    [],
  );

  const copy = async (what: Exclude<Feedback, null>, text: string) => {
    if (!(await copyToClipboard(text))) return;
    setCopied(what);
    // Restart the countdown so this click gets the full duration, whichever
    // button (if any) was showing feedback before.
    if (revertTimer.current !== null) clearTimeout(revertTimer.current);
    revertTimer.current = setTimeout(() => {
      revertTimer.current = null;
      setCopied(null);
    }, 1500);
  };

  const canCopyContent = Boolean(content);

  const buttons = (play?: ReactNode) => (
    <>
      {play}
      <button
        data-testid={`${testIdPrefix}-vscode`}
        onClick={() => openInVSCode(absolutePath)}
        className={BUTTON_CLASS}
        style={{ color: "var(--text-secondary)" }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--bg-hover)";
          e.currentTarget.style.color = "var(--text-primary)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--text-secondary)";
        }}
      >
        <ExternalLink className="w-3.5 h-3.5" /> VS Code
      </button>
      <button
        data-testid={`${testIdPrefix}-copy-path`}
        onClick={() => {
          if (relativePath !== null) void copy("path", relativePath);
        }}
        disabled={relativePath === null}
        title="Copy path relative to the workspace"
        className={BUTTON_CLASS}
        style={{
          color: copied === "path" ? "var(--green)" : "var(--text-secondary)",
          opacity: relativePath === null ? 0.4 : 1,
        }}
      >
        {copied === "path" ? (
          <Check className="w-3.5 h-3.5" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
        {copied === "path" ? "Copied" : "Path"}
      </button>
      {copyLinkText !== undefined && (
        <button
          data-testid={`${testIdPrefix}-copy-link`}
          onClick={() => {
            if (copyLinkText !== null) void copy("link", copyLinkText);
          }}
          disabled={copyLinkText === null}
          title="Copy a markdown link to this mockup in the panel"
          className={BUTTON_CLASS}
          style={{
            color: copied === "link" ? "var(--green)" : "var(--text-secondary)",
            opacity: copyLinkText === null ? 0.4 : 1,
          }}
        >
          {copied === "link" ? (
            <Check className="w-3.5 h-3.5" />
          ) : (
            <Link className="w-3.5 h-3.5" />
          )}
          {copied === "link" ? "Copied" : "Link"}
        </button>
      )}
      <button
        data-testid={`${testIdPrefix}-copy-absolute`}
        onClick={() => copy("absolute", absolutePath)}
        title="Copy absolute path"
        className={BUTTON_CLASS}
        style={{
          color:
            copied === "absolute" ? "var(--green)" : "var(--text-secondary)",
        }}
      >
        {copied === "absolute" ? (
          <Check className="w-3.5 h-3.5" />
        ) : (
          <FileSymlink className="w-3.5 h-3.5" />
        )}
        {copied === "absolute" ? "Copied" : "Absolute"}
      </button>
      <button
        data-testid={`${testIdPrefix}-copy-content`}
        onClick={() => copy("content", content ?? "")}
        disabled={!canCopyContent}
        className={BUTTON_CLASS}
        style={{
          color:
            copied === "content" ? "var(--green)" : "var(--text-secondary)",
          opacity: canCopyContent ? 1 : 0.4,
        }}
      >
        {copied === "content" ? (
          <Check className="w-3.5 h-3.5" />
        ) : (
          <ClipboardCopy className="w-3.5 h-3.5" />
        )}
        {copied === "content" ? "Copied" : "Copy"}
      </button>
    </>
  );

  if (!speech) return buttons();
  return (
    <SpeakingToolbar speech={speech} testIdPrefix={testIdPrefix}>
      {buttons}
    </SpeakingToolbar>
  );
}

/**
 * The toolbar of a page that can be spoken: the buttons in their row with Play
 * at its head, and the document speech bar unfolded under the row while the
 * page is being read. A component of its own because it is the only part that
 * needs the panel's speech host — a toolbar without `speech` must render
 * outside a `SpeechHostProvider` too.
 *
 * The run belongs to the open page: folding the bar, switching to another page
 * (a new key) and unmounting all stop it, through the one effect that owns the
 * open key. A new `text` for the same key does not restart it; the next Play
 * speaks whatever was loaded at that moment.
 */
function SpeakingToolbar({
  speech,
  testIdPrefix,
  children,
}: {
  speech: DocSpeech;
  testIdPrefix: string;
  children: (play: ReactNode) => ReactNode;
}) {
  const pageSpeech = usePageSpeech();
  // The key whose bar is unfolded. Kept as the KEY rather than a flag so a
  // page switch folds the bar on the very render it happens.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = openKey !== null && openKey === speech.key;

  useEffect(() => {
    if (openKey !== null && openKey !== speech.key) setOpenKey(null);
  }, [openKey, speech.key]);

  // Whatever ends an open key — fold, page switch, unmount — stops its run.
  useEffect(() => {
    if (openKey === null) return;
    return () => pageSpeech.stopDocument(openKey);
  }, [openKey, pageSpeech]);

  const toggle = () => {
    if (open) {
      setOpenKey(null);
      return;
    }
    setOpenKey(speech.key);
    pageSpeech.speakDocument({ key: speech.key, text: speech.text });
  };

  // A page that prepares to nothing — still loading, code blocks only,
  // frontmatter only — offers no Play. Prepared once per text, not per render.
  // An unfolded bar keeps its Stop whatever the text became: folding is how
  // the run ends.
  const speakable = useMemo(() => pageHasSpeech(speech.text), [speech.text]);
  const disabled = !open && !speakable;
  const reasonId = useId();

  // The accessible name stays the visible "Play"/"Stop" (label-in-name); why a
  // disabled Play is disabled is its description and tooltip. The text flip is
  // the state, so there is no `aria-pressed` on top of it — "Stop, pressed"
  // would say it twice. The reason is aria-hidden so it stays out of the
  // name; `aria-describedby` still reads hidden content.
  const play = (
    <button
      data-testid={`${testIdPrefix}-play`}
      onClick={toggle}
      disabled={disabled}
      aria-describedby={disabled ? reasonId : undefined}
      title={open ? "Stop reading this page" : disabled ? NOTHING_TO_SPEAK : "Read this page aloud"}
      className={BUTTON_CLASS}
      style={{
        color: open ? "var(--green)" : "var(--text-secondary)",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {open ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
      {open ? "Stop" : "Play"}
      {disabled && (
        <span id={reasonId} className="sr-only" aria-hidden="true">
          {NOTHING_TO_SPEAK}
        </span>
      )}
    </button>
  );

  // `gap: inherit` keeps the caller's spacing: the buttons used to be its row's
  // direct children, and each call site spaces them its own way.
  return (
    <div className="flex flex-col" style={{ gap: "inherit" }}>
      <div className="flex items-center" style={{ gap: "inherit" }}>
        {children(play)}
      </div>
      {open && (
        <div className="viewer-speech-bar">
          <DocumentSpeechBar docKey={speech.key} />
        </div>
      )}
    </div>
  );
}

export default ViewerActions;
