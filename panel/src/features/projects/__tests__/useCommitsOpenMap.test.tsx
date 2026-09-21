import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useCommitsOpenMap } from "../useCommitsOpenMap";
import { preferences } from "../../../preferences/declarations";
import { readPreference } from "../../../preferences/store";

/**
 * The commits pane's open state changed shape in the preferences migration —
 * from one blob keyed by repo path to one repo-scoped preference per
 * repository — so the two things the blob got right have to be pinned: an
 * absent entry means OPEN, and the number of repositories on screen is free to
 * change between renders.
 */
function Probe({ repos }: { repos: string[] }) {
  const { isOpen, setOpen } = useCommitsOpenMap();
  return (
    <ul>
      {repos.map((repo) => (
        <li key={repo}>
          <span data-testid={`open-${repo}`}>{String(isOpen(repo))}</span>
          <button data-testid={`close-${repo}`} onClick={() => setOpen(repo, false)}>
            close
          </button>
          <button data-testid={`open-again-${repo}`} onClick={() => setOpen(repo, true)}>
            open
          </button>
        </li>
      ))}
    </ul>
  );
}

const open = (repo: string) => screen.getByTestId(`open-${repo}`).textContent;

describe("useCommitsOpenMap", () => {
  it("reads a repository with nothing stored as open", () => {
    render(<Probe repos={["/git/a", "/git/b"]} />);

    expect(open("/git/a")).toBe("true");
    expect(open("/git/b")).toBe("true");
    // And nothing was written to say so: absent is not closed.
    const doc = (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> })
      .__PAVILIO_PREFS__!;
    expect(Object.keys(doc)).toEqual(["version"]);
  });

  it("closes one repository without closing the others", () => {
    render(<Probe repos={["/git/a", "/git/b"]} />);
    fireEvent.click(screen.getByTestId("close-/git/a"));

    expect(open("/git/a")).toBe("false");
    expect(open("/git/b")).toBe("true");
    expect(readPreference(preferences.commitsOpen, "/git/a")).toBe(false);
  });

  it("reopens a closed repository", () => {
    render(<Probe repos={["/git/a"]} />);
    fireEvent.click(screen.getByTestId("close-/git/a"));
    expect(open("/git/a")).toBe("false");

    fireEvent.click(screen.getByTestId("open-again-/git/a"));
    expect(open("/git/a")).toBe("true");
  });

  it("survives a repository list that grows between renders", () => {
    const { rerender } = render(<Probe repos={["/git/a"]} />);
    fireEvent.click(screen.getByTestId("close-/git/a"));

    // One `usePreference` per repository would be one hook per repository, and
    // React would refuse this render.
    rerender(<Probe repos={["/git/a", "/git/b", "/git/c"]} />);
    expect(open("/git/a")).toBe("false");
    expect(open("/git/c")).toBe("true");
  });

  it("treats a tilde path and its absolute form as one repository", () => {
    const globals = globalThis as { __PAVILIO_HOME__?: string };
    globals.__PAVILIO_HOME__ = "/home/greg";
    try {
      render(<Probe repos={["~/git/prv/pavilio", "/home/greg/git/prv/pavilio"]} />);
      fireEvent.click(screen.getByTestId("close-~/git/prv/pavilio"));

      expect(open("/home/greg/git/prv/pavilio")).toBe("false");
    } finally {
      delete globals.__PAVILIO_HOME__;
    }
  });
});
