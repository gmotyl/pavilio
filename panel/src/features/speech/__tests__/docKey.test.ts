/**
 * A page's speech key is `doc:` plus its path relative to the projects
 * directory; the project is the path's first segment, and a file outside the
 * projects directory (a leading `..`, or no directory at all) has none.
 */
import { describe, expect, it } from "vitest";

import { docSpeechKey, isDocSpeechKey, projectOfDocKey } from "../docKey";

describe("doc speech key", () => {
  it("docSpeechKey round-trips and projectOfDocKey reads the project segment", () => {
    const key = docSpeechKey("pavilio/wiki/x.md");

    expect(key).toBe("doc:pavilio/wiki/x.md");
    expect(isDocSpeechKey(key)).toBe(true);
    expect(isDocSpeechKey("sess-1")).toBe(false);
    expect(isDocSpeechKey("doc-sess")).toBe(false);
    expect(projectOfDocKey(key)).toBe("pavilio");
    expect(projectOfDocKey(docSpeechKey("p/STATUS.md"))).toBe("p");
  });

  it("projectOfDocKey is null for a file outside projects", () => {
    expect(projectOfDocKey("doc:../AGENTS.md")).toBeNull();
    expect(projectOfDocKey("doc:../../repo/x.md")).toBeNull();
    expect(projectOfDocKey("doc:AGENTS.md")).toBeNull();
    expect(projectOfDocKey("doc:./x/y.md")).toBeNull();
    expect(projectOfDocKey("doc:/x/y.md")).toBeNull();
    expect(projectOfDocKey("sess-1")).toBeNull();
    expect(projectOfDocKey("pavilio/wiki/x.md")).toBeNull();
  });
});
