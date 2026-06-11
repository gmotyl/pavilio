/**
 * Sections with bespoke rendering that bypass the generic file-list / inline
 * FileViewer path and don't own the `?file=` URL param (repos, iterm, context
 * have their own surfaces; plans uses the PlansTab tree).
 */
export const SPECIAL_SECTIONS = new Set(["repos", "iterm", "context", "plans"]);
