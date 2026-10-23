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

/**
 * Names a project may never take: the archive dir itself, and every literal single-segment
 * `/api/projects/<segment>` route, which is registered ahead of `GET /:name` and would shadow it.
 */
const RESERVED_SLUGS = new Set(["archived", "default-terminal-users"]);

/** A slug (lowercase letters, digits, `.`, `_`, `-`; starts alphanumeric), not a reserved name. */
export function isValidProjectSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*$/.test(slug) && !RESERVED_SLUGS.has(slug);
}
