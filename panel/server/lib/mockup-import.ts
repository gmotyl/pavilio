// Pure helpers for importing mockup files (Figma exports) into
// `projects/<project>/mockups/`: type sniffing, slug normalisation, naming and
// the external-resource count the import dialog warns about.
import { extname, isAbsolute, relative } from "path";

export const MOCKUP_MAX_BYTES = 20 * 1024 * 1024;

const SUPPORTED_EXTS = [".html", ".svg", ".png", ".jpg", ".jpeg", ".webp"] as const;
const TEXT_SNIFF_BYTES = 4096;
const SLUG_MAX = 60;

export type SniffResult = { ok: true; ext: string } | { ok: false; error: string };

/** True when `abs` is the root itself or lies under it (no `..` traversal). */
export function isPathUnder(abs: string, root: string): boolean {
  if (abs === root) return true;
  const rel = relative(root, abs);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** Canonical extension written to disk: lower-case, `.jpeg` → `.jpg`. */
function canonicalExt(ext: string): string {
  const lower = ext.toLowerCase();
  return lower === ".jpeg" ? ".jpg" : lower;
}

function startsWithBytes(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

function decodeUtf8(buf: Buffer): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return null;
  }
}

/**
 * Accept a file only when its extension is supported AND its bytes agree, so
 * an HTML page renamed `.png` cannot slip in as an image.
 */
export function sniffMockup(originalName: string, buf: Buffer): SniffResult {
  const rawExt = extname(originalName).toLowerCase();
  if (!(SUPPORTED_EXTS as readonly string[]).includes(rawExt)) {
    return {
      ok: false,
      error: `Unsupported file type${rawExt ? ` ${rawExt}` : ""} — use SVG, PNG, JPEG, WebP or HTML`,
    };
  }
  const ext = canonicalExt(rawExt);
  const mismatch: SniffResult = {
    ok: false,
    error: `File content does not match its ${rawExt} extension`,
  };

  switch (ext) {
    case ".png":
      return startsWithBytes(buf, [0x89, 0x50, 0x4e, 0x47]) ? { ok: true, ext } : mismatch;
    case ".jpg":
      return startsWithBytes(buf, [0xff, 0xd8, 0xff]) ? { ok: true, ext } : mismatch;
    case ".webp":
      return buf.length >= 12 &&
        buf.toString("latin1", 0, 4) === "RIFF" &&
        buf.toString("latin1", 8, 12) === "WEBP"
        ? { ok: true, ext }
        : mismatch;
    default: {
      // .svg / .html: valid UTF-8 text with the right root marker up front
      const text = decodeUtf8(buf);
      if (text === null) return mismatch;
      const head = text.slice(0, TEXT_SNIFF_BYTES).toLowerCase();
      const found =
        ext === ".svg" ? head.includes("<svg") : head.includes("<html") || head.includes("<!doctype html");
      return found ? { ok: true, ext } : mismatch;
    }
  }
}

/** Lower-case, `[a-z0-9-]` only, dash runs collapsed, trimmed, max 60 chars. */
export function normaliseSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, "");
}

/** The slug part of the name: the slug, else the original basename, else `mockup`. */
export function mockupBaseName(slug: string | undefined, originalName: string): string {
  const fromSlug = normaliseSlug(slug ?? "");
  if (fromSlug) return fromSlug;
  const base = originalName.slice(0, originalName.length - extname(originalName).length);
  return normaliseSlug(base) || "mockup";
}

/** `YYYY-MM-DD-<slug>[-n].<ext>`; `n` (≥ 2) is the collision suffix. */
export function mockupFileName(
  date: string,
  slug: string | undefined,
  originalName: string,
  ext: string,
  n = 1,
): string {
  const suffix = n > 1 ? `-${n}` : "";
  return `${date}-${mockupBaseName(slug, originalName)}${suffix}${canonicalExt(ext)}`;
}

// Attribute names are anchored so `data-src=` and the `href` inside
// `xlink:href` are not counted on their own.
const ATTR_RE = /(?<![\w:-])(?:xlink:href|href|src|srcset)\s*=\s*["']?\s*(?:https?:|\/\/)/gi;
const CSS_URL_RE = /url\(\s*["']?\s*(?:https?:|\/\/)/gi;
// `@import url(...)` is already counted by CSS_URL_RE
const CSS_IMPORT_RE = /@import\s+["']\s*(?:https?:|\/\/)/gi;

/**
 * Number of resources an HTML/SVG file loads from the network (and that will
 * therefore not render offline). Raster files always return 0.
 */
export function countExternalResources(originalName: string, buf: Buffer): number {
  const ext = extname(originalName).toLowerCase();
  if (ext !== ".html" && ext !== ".svg") return 0;
  const text = buf.toString("utf-8");
  const count = (re: RegExp) => text.match(re)?.length ?? 0;
  return count(ATTR_RE) + count(CSS_URL_RE) + count(CSS_IMPORT_RE);
}
