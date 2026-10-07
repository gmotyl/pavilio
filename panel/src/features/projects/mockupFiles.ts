/**
 * Which files the panel renders as a mockup rather than as text. The extension,
 * not the folder, decides — the same rule every viewer (the project section
 * pane and the standalone `/view/*` route) applies.
 *
 * The image list mirrors the server's `MOCKUP_IMAGE_EXTS` (file index) and the
 * import allow-list; the panel's tsconfig does not reach `server/`, so the
 * client keeps its own copy here — one copy for the whole client.
 */
const MOCKUP_IMAGE_EXTS = [".svg", ".png", ".jpg", ".jpeg", ".webp"] as const;

const lower = (path: string) => path.toLowerCase();

/** An HTML mockup: rendered in a sandboxed frame. */
export const isHtmlMockup = (path: string) => lower(path).endsWith(".html");

/** An image mockup (SVG, PNG, JPEG, WebP): rendered through `<img>`. */
export const isMockupImage = (path: string) => {
  const p = lower(path);
  return MOCKUP_IMAGE_EXTS.some((ext) => p.endsWith(ext));
};

/** An image whose bytes are not text, so there is no content to copy. */
export const isRasterImage = (path: string) =>
  isMockupImage(path) && !lower(path).endsWith(".svg");

/** Any file a viewer hands to `MockupFrame` instead of showing its source. */
export const isMockupFile = (path: string) =>
  isHtmlMockup(path) || isMockupImage(path);

/**
 * A `/api/files/read/…` URL that only resolves the file's absolute path: the
 * server skips reading the bytes, so an image is never decoded as utf-8 text.
 */
export const metaReadUrl = (readUrl: string) =>
  `${readUrl}${readUrl.includes("?") ? "&" : "?"}meta=1`;

/**
 * Import limits — mirrors the server's `MOCKUP_MAX_BYTES` so an oversized file
 * is rejected in the dialog instead of after its upload.
 */
export const MOCKUP_MAX_BYTES = 20 * 1024 * 1024;

/** The file picker's `accept`: every extension the import route takes. */
export const MOCKUP_IMPORT_ACCEPT = [".html", ...MOCKUP_IMAGE_EXTS].join(",");

/** The extension (with dot, lower-case) of a file name, or "" when it has none. */
export const fileExt = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
};

/** The extension the server writes: `.jpeg` is saved as `.jpg`. */
export const importedExt = (name: string) => {
  const ext = fileExt(name);
  return ext === ".jpeg" ? ".jpg" : ext;
};

// Letters NFKD does not decompose into base + combining mark
const LETTER_FOLDS: Record<string, string> = {
  ł: "l",
  Ł: "L",
  ß: "ss",
  ø: "o",
  Ø: "O",
  đ: "d",
  Đ: "D",
};

/**
 * The slug the server would derive from `input` — lower-case, diacritics
 * folded to ASCII, `[a-z0-9-]` only, dash runs collapsed, trimmed, max 60
 * chars. The client only uses it to PRE-FILL the dialog; whatever the user
 * types is sent as-is and normalised server-side.
 */
export const normaliseMockupSlug = (input: string) =>
  input
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[łŁßøØđĐ]/g, (c) => LETTER_FOLDS[c] ?? c)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
