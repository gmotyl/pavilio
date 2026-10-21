/**
 * Sections with bespoke rendering that bypass the generic file-list / inline
 * FileViewer path (repos, iterm, context have their own surfaces; plans and
 * wiki use their own trees — PlansTab / WikiTab — which manage the `?file=`
 * param themselves).
 */
export const SPECIAL_SECTIONS = new Set(["repos", "iterm", "context", "plans", "wiki"]);
