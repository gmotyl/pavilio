/**
 * WebVTT subtitles → readable transcript markdown.
 *
 * YouTube automatic captions "roll": each cue repeats the previous line and adds a new one
 * carrying word-timing tags (`<00:00:04.760><c> word</c>`), and tiny 10 ms cues repeat the
 * finished line once more. Tags are stripped and a line equal to the last emitted line is
 * dropped, so every spoken line appears once. Paragraphs open with a `[mm:ss]` marker
 * (`[h:mm:ss]` past an hour) about every `markerEverySec` seconds.
 */

export type Cue = { start: number; lines: string[] };

const TIMING_RE = /^(\d{1,2}:)?(\d{2}):(\d{2})[.,](\d{3})\s+-->/;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function seconds(line: string): number {
  const m = TIMING_RE.exec(line)!;
  const hours = m[1] ? Number(m[1].slice(0, -1)) : 0;
  return hours * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

/** Strip timing/style tags and entities, collapse whitespace. */
function cleanLine(line: string): string {
  return line
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (e) => ENTITIES[e])
    .replace(/\s+/g, " ")
    .trim();
}

/** Cues with their start time and cleaned, non-empty text lines; header/NOTE/STYLE blocks skipped. */
export function parseVtt(vtt: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of vtt.replace(/\r\n?/g, "\n").split(/\n\n+/)) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => TIMING_RE.test(l.trim()));
    if (at === -1) continue;
    const text = lines.slice(at + 1).map(cleanLine).filter(Boolean);
    cues.push({ start: seconds(lines[at].trim()), lines: text });
  }
  return cues;
}

export function formatStamp(totalSeconds: number): string {
  const s = Math.floor(totalSeconds);
  const hh = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return hh > 0 ? `[${hh}:${mm}:${ss}]` : `[${mm}:${ss}]`;
}

/** Transcript body: paragraphs of deduplicated lines, each opened by a timestamp marker. */
export function vttToMarkdown(vtt: string, markerEverySec = 30): string {
  const paragraphs: string[] = [];
  let current: string[] = [];
  let last = "";
  let nextMarker = 0;
  for (const cue of parseVtt(vtt)) {
    for (const line of cue.lines) {
      if (line === last) continue;
      last = line;
      if (cue.start >= nextMarker || paragraphs.length + current.length === 0) {
        if (current.length) paragraphs.push(current.join(" "));
        current = [formatStamp(cue.start)];
        nextMarker = (Math.floor(cue.start / markerEverySec) + 1) * markerEverySec;
      }
      current.push(line);
    }
  }
  if (current.length) paragraphs.push(current.join(" "));
  return paragraphs.join("\n\n");
}
