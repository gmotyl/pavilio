import { describe, expect, it } from "vitest";
import { parseWikiLink, shortLabel } from "../wikilinks";

describe("shortLabel", () => {
  it("shortLabel strips kind and date from a dated source", () => {
    expect(shortLabel("wiki/sources/progress-2026-09-23-repos-resize-answer-pane")).toBe("repos resize answer pane");
    expect(shortLabel("wiki/sources/context-snapshot-2026-10-21-speech")).toBe("speech");
  });

  it("shortLabel strips the file and article source kinds", () => {
    expect(shortLabel("wiki/sources/file-2026-10-13-runbook")).toBe("runbook");
    expect(shortLabel("wiki/sources/article-2026-10-13-edge-tts-voices")).toBe("edge tts voices");
  });

  it("shortLabel strips a time after the date (dashed and compact)", () => {
    expect(shortLabel("wiki/sources/note-2026-10-26_09-39-29_middleware_language_parameter_handling"))
      .toBe("middleware language parameter handling");
    expect(shortLabel("wiki/sources/memo-2026-10-25_1945_sniper_logs")).toBe("sniper logs");
  });

  it("shortLabel strips a bare date from a record path", () => {
    expect(shortLabel("progress/2026-10-19-tts-relay-node20")).toBe("tts relay node20");
  });

  it("shortLabel keeps the file name when nothing follows the date", () => {
    expect(shortLabel("wiki/sources/context-snapshot-2026-10-21")).toBe("context-snapshot-2026-10-21");
  });

  it("shortLabel keeps undated file names unchanged", () => {
    expect(shortLabel("wiki/sources/design-sniper-mvp")).toBe("design-sniper-mvp");
    expect(shortLabel("wiki/sources/youtube-x9Ux-Anb_vk")).toBe("youtube-x9Ux-Anb_vk");
    expect(shortLabel("wiki/concepts/resizable-pane")).toBe("resizable-pane");
  });
});

describe("parseWikiLink label", () => {
  it("parseWikiLink prefers an explicit label and falls back to the short label", () => {
    expect(parseWikiLink("metro:wiki/entities/jane-doe|Jane")).toEqual({
      raw: "metro:wiki/entities/jane-doe|Jane",
      project: "metro",
      target: "wiki/entities/jane-doe",
      label: "Jane",
    });
    expect(parseWikiLink("wiki/sources/progress-2026-09-23-x|  ")).toEqual({
      raw: "wiki/sources/progress-2026-09-23-x|  ",
      target: "wiki/sources/progress-2026-09-23-x",
      label: "x",
    });
    expect(parseWikiLink("wiki/concepts/resizable-pane")?.label).toBe("resizable-pane");
  });
});
