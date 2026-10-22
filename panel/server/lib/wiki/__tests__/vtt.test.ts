import { describe, it, expect } from "vitest";

import { vttToMarkdown } from "../vtt";

// YouTube auto-caption shape: every cue repeats the previous line, then adds a word-timed line;
// a 10 ms cue in between repeats the finished line once more.
const ROLLING_VTT = `WEBVTT
Kind: captions
Language: en

00:00:00.000 --> 00:00:02.000 align:start position:0%
 
hello<00:00:00.400><c> world</c><00:00:00.800><c> again</c>

00:00:02.000 --> 00:00:02.010 align:start position:0%
hello world again


00:00:02.010 --> 00:00:04.000 align:start position:0%
hello world again
this<00:00:02.500><c> is</c><00:00:03.000><c> new</c>

00:00:04.000 --> 00:00:04.010 align:start position:0%
this is new

`;

function cue(start: number, text: string): string {
  const stamp = (s: number) => {
    const hh = String(Math.floor(s / 3600)).padStart(2, "0");
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${hh}:${mm}:${ss}.000`;
  };
  return `${stamp(start)} --> ${stamp(start + 4)}\n${text}\n`;
}

describe("vttToMarkdown", () => {
  it("vtt strips word timing and rolling duplicates", () => {
    const body = vttToMarkdown(ROLLING_VTT);
    expect(body).not.toMatch(/<\d{2}:\d{2}:\d{2}\.\d{3}>/);
    expect(body).not.toMatch(/<\/?c[^>]*>/);
    expect(body).not.toMatch(/WEBVTT|Kind:|Language:|-->/);
    expect(body.match(/hello world again/g)).toHaveLength(1);
    expect(body.match(/this is new/g)).toHaveLength(1);
    expect(body).toContain("[00:00] hello world again this is new");
  });

  it("vtt emits timestamp markers about every 30 seconds", () => {
    // A manual track: one cue every 5 s for 2 minutes, each with its own line.
    const cues = Array.from({ length: 24 }, (_, i) => cue(i * 5, `line ${i} &amp; more`));
    const body = vttToMarkdown(`WEBVTT\n\n${cues.join("\n")}`);
    const markers = [...body.matchAll(/^\[(\d{2}):(\d{2})\]/gm)].map((m) => Number(m[1]) * 60 + Number(m[2]));
    expect(markers).toEqual([0, 30, 60, 90]);
    expect(body).toContain("line 5 & more");
    // Each paragraph starts with its marker.
    expect(body.split("\n\n").every((p) => /^\[\d{2}:\d{2}\] /.test(p))).toBe(true);
  });
});
