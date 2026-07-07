/**
 * Sections with bespoke rendering that bypass the generic file-list / inline
 * FileViewer path (repos, iterm, context have their own surfaces; plans uses
 * the PlansTab tree, which manages the `?file=` param itself).
 */
export const SPECIAL_SECTIONS = new Set(["repos", "iterm", "context", "plans"]);
