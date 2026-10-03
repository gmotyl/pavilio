/**
 * The words on a system notification raised when a session starts wanting you.
 *
 * The title is the project, because with several projects open that is the
 * first thing you need to know. The body names the terminal (its published
 * title, else its session name) and then previews what the agent last said, so
 * the notification carries the answer's gist rather than a bare "an agent
 * finished".
 *
 * The preview reuses the speech filter, `stripToSpeakableText`, instead of a
 * second stripper: one place decides what of an answer is worth surfacing.
 * Its removal sentinels (`⟦code⟧`, `⟦table⟧`, …) survive into the preview as
 * written — they name what was skipped and are not markdown.
 */
import { stripToSpeakableText } from "../speech/strip";

/**
 * Longest preview line, ellipsis included. Lock screens and notification
 * shades clip long bodies anyway; a bound we pick ourselves cuts on a word.
 */
export const MAX_PREVIEW_CHARS = 120;

const ELLIPSIS = "…";

export interface NotificationCopy {
  title: string;
  body: string;
  tag: string;
  data: { sessionId: string; project: string };
}

/**
 * Drops the heading `#` and emphasis markers `stripToSpeakableText`
 * deliberately leaves for the speech unit builder — on a screen they are
 * plain markdown noise.
 */
function removeMarkers(text: string): string {
  return text
    .replace(/^ {0,3}#{1,6}[ \t]+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*/g, "");
}

/** Cuts `text` to the bound on a word boundary, ellipsis included. */
function truncate(text: string): string {
  if (text.length <= MAX_PREVIEW_CHARS) return text;

  const room = MAX_PREVIEW_CHARS - ELLIPSIS.length;
  let cut = text.slice(0, room);
  // Unless the bound falls exactly on a space, back off to the last one so no
  // word is split. A single word longer than the bound is cut where it stands.
  if (text[room] !== " ") {
    const lastSpace = cut.lastIndexOf(" ");
    if (lastSpace > 0) cut = cut.slice(0, lastSpace);
  }
  return `${cut.trimEnd()}${ELLIPSIS}`;
}

function previewOf(utterance: string): string {
  const plain = removeMarkers(stripToSpeakableText(utterance)).replace(/\s+/g, " ").trim();
  return truncate(plain);
}

export function notificationText(input: {
  session: { id: string; name: string; project: string; title?: string };
  latestUtterance?: string;
}): NotificationCopy {
  const { session, latestUtterance } = input;
  const heading = session.title || session.name;
  const preview = latestUtterance ? previewOf(latestUtterance) : "";

  return {
    title: session.project,
    body: preview ? `${heading}\n${preview}` : heading,
    tag: session.id,
    data: { sessionId: session.id, project: session.project },
  };
}
