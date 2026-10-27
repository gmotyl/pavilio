import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, readFileSync, existsSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { parseAtlassianUrl, saveAtlassian } from "../save-atlassian";

const HOST = "acme.atlassian.net";
const NOW = new Date("2026-10-27T13:07:34Z");
const LONG_BODY = "The checkout service owns cart pricing and calls the promotions engine on every update. ".repeat(10);

let projectDir = "";

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "save-atlassian-"));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

const rawDir = () => join(projectDir, "wiki", "raw");

describe("parseAtlassianUrl", () => {
  it("parses the three Confluence page URL forms", () => {
    const expected = { kind: "confluence", host: HOST, id: "123456" };
    expect(parseAtlassianUrl(`https://${HOST}/wiki/spaces/ENG/pages/123456/Checkout+Pricing`)).toEqual(expected);
    expect(parseAtlassianUrl(`https://${HOST}/wiki/spaces/ENG/pages/123456`)).toEqual(expected);
    expect(parseAtlassianUrl(`https://${HOST}/wiki/pages/viewpage.action?pageId=123456`)).toEqual(expected);
    expect(parseAtlassianUrl(`https://${HOST}/wiki/pages/123456`)).toEqual(expected);
  });

  it("parses Jira browse and selectedIssue URLs", () => {
    const expected = { kind: "jira", host: HOST, key: "CHK-42" };
    expect(parseAtlassianUrl(`https://${HOST}/browse/CHK-42`)).toEqual(expected);
    expect(parseAtlassianUrl(`https://${HOST}/jira/software/projects/CHK/boards/7?selectedIssue=CHK-42`)).toEqual(expected);
  });

  it("returns null for overview, tiny link and non-Atlassian URLs", () => {
    expect(parseAtlassianUrl(`https://${HOST}/wiki/spaces/ENG/overview`)).toBeNull();
    expect(parseAtlassianUrl(`https://${HOST}/wiki/x/AbCdEf`)).toBeNull();
    expect(parseAtlassianUrl("https://example.com/wiki/spaces/ENG/pages/123456")).toBeNull();
    expect(parseAtlassianUrl("https://example.com/browse/CHK-42")).toBeNull();
    expect(parseAtlassianUrl("not a url")).toBeNull();
  });
});

describe("saveAtlassian", () => {
  it("writes confluence-<id>-<slug>.md with frontmatter, title, meta and body", () => {
    const url = `https://${HOST}/wiki/spaces/ENG/pages/123456/Checkout+Pricing`;
    const body = "## Scope\n\nLine one.\n\n  indented line kept\n";
    const receipt = saveAtlassian(projectDir, url, {
      title: "Checkout Pricing Rules",
      body,
      meta: { space: "ENG", version: "7" },
      now: NOW,
    });
    expect(receipt).toEqual({ raw: "raw/confluence-123456-checkout-pricing-rules.md", title: "Checkout Pricing Rules" });
    const text = readFileSync(join(projectDir, "wiki", receipt.raw), "utf8");
    expect(text).toBe(
      [
        "---",
        `source_url: ${JSON.stringify(url)}`,
        "captured: 2026-10-27",
        "---",
        "",
        "# Checkout Pricing Rules",
        "",
        "- space: ENG",
        "- version: 7",
        "",
        body,
      ].join("\n"),
    );
  });

  it("writes jira-<KEY>.md for an issue", () => {
    const url = `https://${HOST}/browse/CHK-42`;
    const receipt = saveAtlassian(projectDir, url, { title: "Promo stacking breaks totals", body: LONG_BODY, now: NOW });
    expect(receipt.raw).toBe("raw/jira-CHK-42.md");
    expect(readdirSync(rawDir())).toEqual(["jira-CHK-42.md"]);
    const text = readFileSync(join(rawDir(), "jira-CHK-42.md"), "utf8");
    expect(text).toContain("# Promo stacking breaks totals\n\n");
    expect(text.endsWith(LONG_BODY)).toBe(true);
  });

  it("replaces an old-slug file for the same page id", () => {
    mkdirSync(rawDir(), { recursive: true });
    writeFileSync(join(rawDir(), "confluence-123456-old-title.md"), "old");
    // A different page id sharing the prefix must survive.
    writeFileSync(join(rawDir(), "confluence-1234567-other-page.md"), "other");
    writeFileSync(join(rawDir(), "confluence-12-short-id.md"), "short");
    const url = `https://${HOST}/wiki/pages/123456`;
    const receipt = saveAtlassian(projectDir, url, { title: "New Title", body: LONG_BODY, now: NOW });
    expect(receipt.raw).toBe("raw/confluence-123456-new-title.md");
    expect(receipt.replaced).toEqual(["raw/confluence-123456-old-title.md"]);
    expect(readdirSync(rawDir()).sort()).toEqual([
      "confluence-12-short-id.md",
      "confluence-123456-new-title.md",
      "confluence-1234567-other-page.md",
    ]);

    // Re-saving under the same slug refreshes in place and replaces nothing.
    const again = saveAtlassian(projectDir, url, { title: "New Title", body: LONG_BODY, now: NOW });
    expect(again.replaced).toBeUndefined();
  });

  it("refuses an empty body or a short login stub", () => {
    const url = `https://${HOST}/wiki/pages/123456`;
    const empty = saveAtlassian(projectDir, url, { title: "Page", body: "  \n\n ", now: NOW });
    expect(empty.warning).toBeTruthy();
    const stub = saveAtlassian(projectDir, url, {
      title: "Page",
      body: "You need to log in with your Atlassian account to view this page. Continue with Google.",
      now: NOW,
    });
    expect(stub.warning).toBeTruthy();
    expect(existsSync(rawDir()) ? readdirSync(rawDir()) : []).toEqual([]);
  });

  it("keeps a long body that mentions logging in", () => {
    const url = `https://${HOST}/browse/CHK-7`;
    const body = `${LONG_BODY}\nUsers who log in with SSO see the cached cart.`;
    const receipt = saveAtlassian(projectDir, url, { title: "SSO cart", body, now: NOW });
    expect(receipt.warning).toBeUndefined();
    expect(existsSync(join(rawDir(), "jira-CHK-7.md"))).toBe(true);
  });
});
