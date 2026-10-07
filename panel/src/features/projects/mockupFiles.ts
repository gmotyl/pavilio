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
