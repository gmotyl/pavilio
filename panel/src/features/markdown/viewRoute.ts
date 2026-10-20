/**
 * The `/view/*` route carries a file path whose segments may be percent-encoded (wikilink hrefs
 * encode `#`, `?` and spaces; the browser encodes spaces in raw hrefs). Everything that compares
 * the route to a raw file path, or builds an API URL from it, goes through these helpers.
 */

/** Decode each `/`-separated segment; a segment with a malformed escape is kept verbatim. */
export function decodePathSegments(path: string): string {
  return path
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}

/** Percent-encode each `/`-separated segment of a raw path. */
export function encodePathSegments(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** The raw projectsDir-relative file path of a `/view/<path>` pathname. */
export function viewFilePath(pathname: string): string {
  return decodePathSegments(pathname.replace(/^\/view\//, ""));
}
