import { describe, it, expect } from "vitest";
import {
  normaliseSlug,
  mockupBaseName,
  mockupFileName,
  sniffMockup,
  countExternalResources,
} from "../mockup-import";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from("WEBPVP8 "),
]);

describe("mockup-import naming", () => {
  it("normalises the slug", () => {
    expect(normaliseSlug("Account Details / Mobile!!")).toBe("account-details-mobile");
    expect(normaliseSlug("  --Frame__12--  ")).toBe("frame-12");
    expect(normaliseSlug("../../etc/passwd")).toBe("etc-passwd");
    expect(normaliseSlug("a".repeat(80))).toHaveLength(60);
    // Truncation never leaves a trailing dash
    expect(normaliseSlug(`${"a".repeat(59)} b`)).toBe("a".repeat(59));
    expect(mockupFileName("2026-10-07", "Account Details / Mobile!!", "x.png", ".png")).toBe(
      "2026-10-07-account-details-mobile.png",
    );
  });

  it("falls back to basename then mockup", () => {
    expect(mockupBaseName("", "Frame 12.png")).toBe("frame-12");
    expect(mockupBaseName("   ", "Frame 12.png")).toBe("frame-12");
    expect(mockupBaseName(undefined, "Frame 12.png")).toBe("frame-12");
    expect(mockupBaseName("!!", "@@@.png")).toBe("mockup");
    expect(mockupFileName("2026-10-07", "", "", ".svg")).toBe("2026-10-07-mockup.svg");
  });

  it("maps jpeg to jpg", () => {
    expect(mockupFileName("2026-10-07", "shot", "shot.jpeg", ".jpeg")).toBe("2026-10-07-shot.jpg");
    expect(mockupFileName("2026-10-07", "shot", "shot.JPG", ".JPG")).toBe("2026-10-07-shot.jpg");
    expect(mockupFileName("2026-10-07", "shot", "shot.png", ".png", 3)).toBe(
      "2026-10-07-shot-3.png",
    );
  });
});

describe("mockup-import sniffing", () => {
  it("accepts files whose bytes match their extension", () => {
    expect(sniffMockup("a.png", PNG)).toEqual({ ok: true, ext: ".png" });
    expect(sniffMockup("a.jpeg", JPEG)).toEqual({ ok: true, ext: ".jpg" });
    expect(sniffMockup("a.webp", WEBP)).toEqual({ ok: true, ext: ".webp" });
    expect(sniffMockup("a.svg", Buffer.from('<?xml version="1.0"?><svg/>'))).toEqual({
      ok: true,
      ext: ".svg",
    });
    expect(sniffMockup("a.html", Buffer.from("<!DOCTYPE html><p>x"))).toEqual({
      ok: true,
      ext: ".html",
    });
  });

  it("rejects unsupported types and mismatched bytes", () => {
    expect(sniffMockup("a.pdf", Buffer.from("%PDF-1.7")).ok).toBe(false);
    expect(sniffMockup("a.png", Buffer.from("<!doctype html><p>x")).ok).toBe(false);
    expect(sniffMockup("a.svg", PNG).ok).toBe(false);
    expect(sniffMockup("a.html", Buffer.from([0xff, 0xfe, 0x3c, 0x00])).ok).toBe(false);
  });
});

describe("mockup-import external resources", () => {
  it("counts external resources in html and svg", () => {
    const html = `<!doctype html><html><head>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
      <link rel="icon" href="./favicon.ico">
      </head><body>
      <img src="https://cdn.example.com/a.png" data-src="https://ignored.example.com/x.png">
      <img src='https://cdn.example.com/b.png'>
      <img src="local.png"><a href="#top">top</a>
      </body></html>`;
    expect(countExternalResources("a.html", Buffer.from(html))).toBe(3);

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <style>@import url("https://fonts.example.com/f.css"); @import '//cdn.example.com/g.css';
      .a { background: url(//cdn.example.com/bg.png) } .b { background: url(local.png) }</style>
      <image xlink:href="http://example.com/i.png"/><image href="#local"/>
      <image srcset="https://example.com/s.png 2x"/>
    </svg>`;
    // @import url(...) counts once, @import '//…', url(//…), xlink:href, srcset
    expect(countExternalResources("a.svg", Buffer.from(svg))).toBe(5);

    expect(countExternalResources("a.png", Buffer.from('src="https://x"'))).toBe(0);
  });
});
