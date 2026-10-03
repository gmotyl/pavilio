/**
 * The words on a system notification raised when a session starts wanting you.
 *
 * The title is the project, because with several projects open that is the
 * first thing you need to know. The body names the terminal (its published
 * title, else its session name) and then previews what the agent last said, so
 * the notification carries the answer's gist rather than a bare "an agent
 * finished".
 *
 * The preview reuses the speech filter, `stripToSpeakableText`, and the speech
 * marker remover, `removeMarkers`, instead of a second stripper: one place
 * decides what of an answer is worth surfacing. The filter's removal sentinels
 * (`⟦code⟧`, `⟦table⟧`, …) are turned into a plain word in parentheses, so the
 * preview still says what was skipped without showing the sentinel syntax.
 * Unlike speech, the preview is read, so a literal `*` (`2 * 3`) is kept.
 */
import { removeMarkers } from "../speech/prepare";
import { SENTINEL, stripToSpeakableText } from "../speech/strip";

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
 * The word each removal kind reads as on screen. Keyed by `SENTINEL`'s own
 * kinds, so adding a kind in `strip.ts` fails the type check here until it has
 * a word.
 */
const PLACEHOLDER: Readonly<Record<keyof typeof SENTINEL, string>> = {
  code: "(code)",
  table: "(table)",
  html: "(HTML)",
  image: "(image)",
  link: "(link)",
  expr: "(expression)",
};

/** Built from {@link SENTINEL} so the matched kinds cannot drift from it. */
const SENTINEL_RE = new RegExp(`⟦(${Object.keys(SENTINEL).join("|")})⟧`, "g");

function replaceSentinels(text: string): string {
  return text.replace(SENTINEL_RE, (_, kind: keyof typeof SENTINEL) => PLACEHOLDER[kind]);
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
  const plain = replaceSentinels(
    removeMarkers(stripToSpeakableText(utterance), { keepLiteralAsterisks: true }),
  )
    .replace(/\s+/g, " ")
    .trim();
  return truncate(plain);
}

export function notificationText(input: {
  session: { id: string; name: string; project: string; title?: string };
  latestUtterance?: string;
}): NotificationCopy {
  const { session, latestUtterance } = input;
  // Collapsed so a multi-line title cannot push the preview off line two.
  const heading = (session.title?.trim() || session.name).replace(/\s+/g, " ");
  const preview = latestUtterance ? previewOf(latestUtterance) : "";

  return {
    title: session.project,
    body: preview ? `${heading}\n${preview}` : heading,
    tag: session.id,
    data: { sessionId: session.id, project: session.project },
  };
}
