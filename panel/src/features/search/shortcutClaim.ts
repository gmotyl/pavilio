// A mounted surface with its own Ctrl/⌘+P search takes the shortcut from the global quick finder.
let claims = 0;

/** Claim Ctrl/⌘+P; returns the release. */
export function claimFileShortcut(): () => void {
  claims++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    claims--;
  };
}

export const isFileShortcutClaimed = () => claims > 0;
