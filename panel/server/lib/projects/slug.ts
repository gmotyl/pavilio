/**
 * Project slugs: the one rule for a project's folder name, shared by the scaffold (server) and
 * the panel's "new research" form (client). No node imports, so the client can import it.
 */

/** Letters NFD does not decompose into base + combining mark. */
const UNDECOMPOSABLE: Record<string, string> = { ł: "l", đ: "d", ø: "o", ß: "ss", æ: "ae", œ: "oe" };

/**
 * The slug for a free-text title: lowercase, diacritics folded to ASCII, every run of other
 * characters collapsed to one `-`, no leading or trailing `-`. Empty when nothing is left
 * (e.g. a punctuation-only title), which `isValidProjectSlug` rejects.
 */
export function slugifyProjectTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[łđøßæœ]/g, (c) => UNDECOMPOSABLE[c] ?? c)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A slug (lowercase letters, digits, `.`, `_`, `-`; starts alphanumeric), not the archive dir itself. */
export function isValidProjectSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*$/.test(slug) && slug !== "archived";
}
