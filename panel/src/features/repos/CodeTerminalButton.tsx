import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { SquareTerminal } from "lucide-react";
import { openCodeTerminal } from "./openCodeTerminal";
import { dispatchTerminalFocus } from "../terminal/useTerminalSessions";
import { useTerminalDrawerVisible } from "../terminal/useTerminalDrawer";
import "./CodeTerminalButton.css";

/**
 * The Code toolbar's Terminal button: opens a panel terminal at the checkout
 * root being viewed. Same landing as `useLaunchRun` — the focus broadcast shows
 * it in a visible drawer, otherwise the panel navigates to the Terminals page.
 */
export function CodeTerminalButton({
  project,
  root,
  repoName,
}: {
  project: string;
  root: string;
  repoName: string;
}) {
  const navigate = useNavigate();
  // `useTerminalDrawerVisible`: false (not a throw) outside a drawer provider.
  const drawerVisible = useTerminalDrawerVisible();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const open = async () => {
    setBusy(true);
    setFailed(false);
    try {
      // A rejection (session list or create threw) is a failure like a null create.
      const id = await openCodeTerminal({ project, root, repoName }).catch(() => null);
      if (id === null) {
        setFailed(true);
        return;
      }
      dispatchTerminalFocus(project, id);
      if (!drawerVisible) navigate(`/project/${encodeURIComponent(project)}/iterm`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="cv-term">
      <button
        type="button"
        className="cv-term-btn"
        data-testid="code-terminal"
        title={`Open a terminal at ${root}`}
        disabled={busy}
        onClick={() => void open()}
      >
        <SquareTerminal size={14} aria-hidden="true" />
        {busy ? "Opening…" : "Terminal"}
      </button>
      {failed && (
        <span className="cv-term-err" role="alert">
          Couldn't open a terminal at {root}
          <button type="button" data-testid="code-terminal-error-dismiss" onClick={() => setFailed(false)}>
            Dismiss
          </button>
        </span>
      )}
    </span>
  );
}
