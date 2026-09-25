/** Code spans in the copy: the two commands and the destination folder. */
const CODE_CLASS = "font-mono px-1 py-0.5 rounded";
const CODE_STYLE = {
  background: "var(--bg-surface)",
  color: "var(--text-secondary)",
};

function Code({ children }: { children: string }) {
  return (
    <code className={CODE_CLASS} style={CODE_STYLE}>
      {children}
    </code>
  );
}

/**
 * What the mockups tab shows before anything has written to it. Unlike the
 * other sections, an empty mockups tab is the FIRST thing most people see
 * here — the folder only appears once a mockup lands in it — so the pane
 * teaches the two commands that fill it instead of reporting that a list is
 * empty.
 */
export function MockupsEmptyState({ projectName }: { projectName: string }) {
  return (
    <p
      data-testid="mockups-empty-state"
      className="text-sm max-w-prose leading-relaxed"
      style={{ color: "var(--text-muted)" }}
    >
      No mockups yet. Run{" "}
      {/* The placeholder is what the user types, so it stays literal. */}
      <Code>{"/pavilio-ui-design <what you're designing>"}</Code> in a terminal
      — it works out the design direction, then writes a self-contained HTML
      mockup to <Code>{`projects/${projectName}/mockups/`}</Code>. It usually
      drafts two or three options with a recommendation, so you have something
      to pick from. <Code>{"/pavilio-mockup"}</Code> skips straight to the HTML
      when you already know what you want.
    </p>
  );
}

export default MockupsEmptyState;
