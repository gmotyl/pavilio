import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";

/**
 * Every write that reached the preference store, so "the bookmark is still
 * being recorded on a phone" can be asserted on the WRITE itself rather than on
 * the value that happens to be sitting there afterwards. Reading the value back
 * proves only that nothing wrote a DIFFERENT value, and an implementation that
 * suppressed bookmarking on a narrow viewport would leave the previous value in
 * place and pass such a test.
 *
 * The factory is hoisted above the imports, so the array it closes over has to
 * be hoisted with it.
 */
const { writes, SESSION, projectName } = vi.hoisted(() => ({
  writes: [] as Array<{ key: string; value: unknown; scope?: string }>,
  /**
   * The single project the sidebar is given, in a box so a test can swap it
   * without re-mocking the module. Most of this file works with a plain name;
   * the encoding tests need one that a URL cannot carry verbatim.
   */
  projectName: { current: "vector" },
  /**
   * One open session on the project, so the sidebar has a SESSION row to tap as
   * well as a project name. The two rows are meant to obey one rule about where
   * a tap lands, and a suite that only ever rendered the project name could not
   * tell whether they still do. Hoisted with `writes` because the
   * `useAllTerminalSessions` factory below closes over it.
   */
  SESSION: {
    id: "s-vector-1",
    name: "vector-1",
    project: "vector",
    cwd: "/p/vector",
    pid: 4242,
    createdAt: "2026-09-24T09:00:00.000Z",
  },
}));

vi.mock("../../../preferences/store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../preferences/store")>();
  return {
    ...actual,
    writePreference: <T,>(
      def: Parameters<typeof actual.writePreference<T>>[0],
      value: T,
      scopeArg?: string,
    ) => {
      writes.push({ key: def.key, value, scope: scopeArg });
      actual.writePreference(def, value, scopeArg);
    },
  };
});

/**
 * The sidebar reads the speech host, so it needs a real `SpeechHostProvider`
 * above it. Only the host is stubbed — an inert one, since this suite's subject
 * is the project link, not speech.
 */
vi.mock("../../speech/useSpeechHost", async () => {
  const { INERT_SPEECH_HOST } = await import(
    "../../terminal/__tests__/speech.harness"
  );
  return {
    useSpeechHost: () => INERT_SPEECH_HOST,
    default: () => INERT_SPEECH_HOST,
  };
});

import LeftSidebar from "../LeftSidebar";
import { SpeechHostProvider } from "../../speech/SpeechHostProvider";
import ProjectRedirect from "../../projects/ProjectRedirect";
import { readLastPath, writeLastPath } from "../lastPath";
import { useLastPath } from "../useLastPath";
import { preferences } from "../../../preferences/declarations";
import { MOBILE_QUERY } from "../../../lib/breakpoints";

vi.mock("../../projects/useProjects", () => ({
  useProjects: () => [{ name: projectName.current, repos: [] }],
}));
vi.mock("../../projects/useArchivedProjects", () => ({
  useArchivedProjects: () => ({ archive: [], archivedNames: new Set() }),
}));
vi.mock("../../projects/useFavorites", () => ({
  useFavorites: () => ({
    isFavorite: () => false,
    toggleFavorite: () => {},
    favorites: [],
  }),
}));
vi.mock("../../terminal/useAllTerminalSessions", () => ({
  useAllTerminalSessions: () => ({ sessions: [SESSION], refresh: () => {} }),
}));
vi.mock("../../mobile-access/useMobileAccessStatus", () => ({
  useMobileAccessStatus: () => ({ enabled: false }),
}));
vi.mock("../../auto-sync/useAutoSyncStatus", () => ({
  useAutoSyncStatus: () => ({ status: null }),
}));
vi.mock("../../git/useGitStatus", () => ({
  useGitStatus: () => ({ files: [], suggestion: "", refetch: () => {} }),
}));

/** The writes the Last-open-view bookmark received, by the key the store uses. */
const bookmarkWrites = () =>
  writes.filter((w) => w.key === preferences.lastPath.key);

/**
 * A controllable `matchMedia`, the shape the drawer and resizable-row suites
 * use. jsdom's own answers a fixed viewport and dispatches no `change`, so a
 * destination that is supposed to follow a rotation could not be driven
 * through it.
 */
function installMatchMedia(mobile: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  let matches = mobile;
  const mql = {
    get matches() {
      return matches;
    },
    media: MOBILE_QUERY,
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) =>
      listeners.add(cb),
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) =>
      listeners.delete(cb),
    // The deprecated pair, feeding the same listener set. `useIsMobile` reaches
    // only for the modern one today, but a stub that omits these answers
    // `undefined` to a caller that uses the legacy form — a silent no-op rather
    // than a failure, which is exactly the shape of bug a stub should not be
    // able to hide.
    addListener: (cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
    removeListener: (cb: (e: MediaQueryListEvent) => void) =>
      listeners.delete(cb),
  };
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: () => mql,
  });
  return {
    setMobile(next: boolean) {
      matches = next;
      act(() => {
        listeners.forEach((cb) => cb({ matches: next } as MediaQueryListEvent));
      });
    },
  };
}

/** Whatever this environment had before a test installed the stub. */
const nativeMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

function restoreMatchMedia() {
  if (nativeMatchMedia)
    Object.defineProperty(window, "matchMedia", nativeMatchMedia);
  else delete (window as { matchMedia?: unknown }).matchMedia;
}

/**
 * A stand-in for `ProjectView`: it reports where the tap landed and records the
 * bookmark exactly where the real page records it — `useLastPath(name)`, keyed
 * on the route param. The bookmark is written by the page the user arrives at,
 * never by the sidebar, which is why the sidebar can redirect a phone's tap
 * without the bookmark ever noticing.
 */
function Landing() {
  const { name } = useParams<{ name: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  useLastPath(name);
  return (
    <div>
      <span data-testid="landed">{location.pathname}</span>
      {/* The route param as the page sees it — decoded by the router, which is
          the form every preference scope downstream is keyed on. */}
      <span data-testid="landed-name">{name}</span>
      <button
        data-testid="to-memo"
        onClick={() => navigate("/project/vector/memo")}
      >
        memo
      </button>
    </div>
  );
}

/**
 * The sidebar over the two project routes it can send a tap to — the bare one,
 * where `ProjectRedirect` resolves the bookmark, and the section one the
 * bookmark names.
 */
function renderShell(initial = "/") {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <SpeechHostProvider>
        <LeftSidebar />
        <Routes>
          <Route
            path="/project/:name"
            element={<ProjectRedirect fallback={<Landing />} />}
          />
          <Route path="/project/:name/:section" element={<Landing />} />
        </Routes>
      </SpeechHostProvider>
    </MemoryRouter>,
  );
}

const projectLink = () => screen.getByRole("link", { name: "vector" });

/**
 * The project's session rows are behind the disclosure triangle, and the stored
 * expand preference defaults to collapsed — so a suite that wants to tap a
 * session has to open the project first, exactly as a user would.
 */
function expandProject() {
  act(() => {
    fireEvent.click(screen.getByTestId("sidebar-project-expand-vector"));
  });
}

const sessionRow = () => screen.getByTestId(`sidebar-session-${SESSION.id}`);

describe("LeftSidebar project link", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    writes.length = 0;
  });

  // runs even if a test throws mid-body, so a media-query stub cannot leak into
  // the next test
  afterEach(() => {
    restoreMatchMedia();
  });

  it("links the project name to the bare /project/:name route (not /iterm)", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <SpeechHostProvider>
          <LeftSidebar />
        </SpeechHostProvider>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "vector" });
    expect(link).toHaveAttribute("href", "/project/vector");
  });

  /**
   * A phone has one view worth arriving at, and it is the terminal: the
   * sections are reading surfaces the user opens deliberately, while the reason
   * to pick up a phone at all is the agent waiting in a terminal. So the tap is
   * sent there, over the top of whatever view the bookmark holds — a
   * destination override, and nothing more. The bookmark itself keeps being
   * written by the page the user lands on, so their desktop still resumes where
   * they left it.
   */
  describe("on a phone", () => {
    it("sends a phone tap to the project's terminal tab", () => {
      installMatchMedia(true);
      renderShell();

      expect(projectLink()).toHaveAttribute("href", "/project/vector/iterm");
      act(() => {
        fireEvent.click(projectLink());
      });
      expect(screen.getByTestId("landed")).toHaveTextContent(
        "/project/vector/iterm",
      );
    });

    it("overrides a bookmarked view on a phone", () => {
      writeLastPath("vector", "/project/vector/memo");
      installMatchMedia(true);
      renderShell();

      expect(projectLink()).toHaveAttribute("href", "/project/vector/iterm");
      act(() => {
        fireEvent.click(projectLink());
      });
      expect(screen.getByTestId("landed")).toHaveTextContent(
        "/project/vector/iterm",
      );
    });

    it("leaves the desktop destination alone", () => {
      writeLastPath("vector", "/project/vector/memo");
      installMatchMedia(false);
      renderShell();

      expect(projectLink()).toHaveAttribute("href", "/project/vector");
      act(() => {
        fireEvent.click(projectLink());
      });
      // The bare route, resolved through the bookmark by `ProjectRedirect` —
      // the deeper view is restored, exactly as before.
      expect(screen.getByTestId("landed")).toHaveTextContent(
        "/project/vector/memo",
      );
    });

    it("still records the bookmark on a phone", () => {
      // First, prove the spy is live: a desktop tap with nothing bookmarked
      // MUST write the bare route as the new bookmark. Without this the silence
      // that would follow a suppressed write is indistinguishable from a spy
      // that is never reached at all.
      installMatchMedia(false);
      renderShell();
      act(() => {
        fireEvent.click(projectLink());
      });
      expect(bookmarkWrites()).toEqual([
        {
          key: preferences.lastPath.key,
          value: "/project/vector",
          scope: "vector",
        },
      ]);

      cleanup();
      sessionStorage.clear();
      writes.length = 0;

      // Now the phone. The tap lands on the terminal, and moving on from there
      // records that view like any other.
      installMatchMedia(true);
      renderShell();
      act(() => {
        fireEvent.click(projectLink());
      });
      act(() => {
        fireEvent.click(screen.getByTestId("to-memo"));
      });

      expect(bookmarkWrites().map((w) => w.value)).toEqual([
        "/project/vector/iterm",
        "/project/vector/memo",
      ]);
      expect(readLastPath("vector")).toBe("/project/vector/memo");

      // …which is what makes the bare project route still restore it: the
      // override changed one navigation, not what the bookmark means.
      cleanup();
      installMatchMedia(false);
      renderShell("/project/vector");
      expect(screen.getByTestId("landed")).toHaveTextContent(
        "/project/vector/memo",
      );
    });

    /**
     * One rule for both rows. The rationale above never mentions which row the
     * thumb landed on — it is about what is worth arriving at on a phone — so a
     * session row that still went through the bookmark could drop the user on
     * notes from a tap whose whole meaning was "take me to that terminal".
     */
    it("sends a phone tap on a session row to the terminal too", () => {
      writeLastPath("vector", "/project/vector/memo");
      installMatchMedia(true);
      renderShell();
      expandProject();

      act(() => {
        fireEvent.click(sessionRow());
      });
      expect(screen.getByTestId("landed")).toHaveTextContent(
        "/project/vector/iterm",
      );
    });

    it("leaves a session row's desktop destination alone", () => {
      writeLastPath("vector", "/project/vector/memo");
      installMatchMedia(false);
      renderShell();
      expandProject();

      act(() => {
        fireEvent.click(sessionRow());
      });
      // The bare route, resolved through the bookmark by `ProjectRedirect` —
      // the deeper view is restored, exactly as before.
      expect(screen.getByTestId("landed")).toHaveTextContent(
        "/project/vector/memo",
      );
    });

    /**
     * The destination is derived from the LIVE media query, not from a reading
     * taken once at mount — so a phone turned on its side, or a desktop window
     * dragged narrow, moves both rows' destinations with it while the tree
     * stays mounted. Replacing `useIsMobile()` with a one-shot mount read
     * leaves every other test in this file green; this is the one that fails.
     */
    it("follows a rotation under a mounted tree", () => {
      writeLastPath("vector", "/project/vector/memo");
      const media = installMatchMedia(false);
      renderShell();
      expandProject();
      expect(projectLink()).toHaveAttribute("href", "/project/vector");

      media.setMobile(true);
      expect(projectLink()).toHaveAttribute("href", "/project/vector/iterm");
      act(() => {
        fireEvent.click(sessionRow());
      });
      expect(screen.getByTestId("landed")).toHaveTextContent(
        "/project/vector/iterm",
      );

      // …and back again: widening restores the bookmark-resolving route on
      // both rows. The bookmark now holds the terminal — the phone's landing
      // recorded it like any other view — so it is moved off it first, which
      // is what makes the next assertion about resolution rather than about
      // the destination the phone had just used.
      media.setMobile(false);
      expect(projectLink()).toHaveAttribute("href", "/project/vector");
      act(() => {
        fireEvent.click(screen.getByTestId("to-memo"));
      });
      act(() => {
        fireEvent.click(sessionRow());
      });
      expect(screen.getByTestId("landed")).toHaveTextContent(
        "/project/vector/memo",
      );
    });
  });

  /**
   * `QuickTerminalModal` builds the identical `/project/<name>/iterm` target
   * with `encodeURIComponent`, and for a while the sidebar built it without —
   * two spellings of one destination, differing only for the names that need
   * encoding. These pin the encoded spelling end to end: the route still
   * matches it, and `ProjectRedirect` still resolves the bookmark under the
   * DECODED name that `useParams` hands the page.
   */
  describe("a project name that needs encoding", () => {
    beforeEach(() => {
      projectName.current = "my proj#1";
    });
    afterEach(() => {
      projectName.current = "vector";
    });

    const oddLink = () => screen.getByRole("link", { name: "my proj#1" });

    it("encodes the project name into the phone's terminal destination", () => {
      installMatchMedia(true);
      renderShell();

      expect(oddLink()).toHaveAttribute(
        "href",
        "/project/my%20proj%231/iterm",
      );
      act(() => {
        fireEvent.click(oddLink());
      });
      expect(screen.getByTestId("landed")).toHaveTextContent(
        "/project/my%20proj%231/iterm",
      );
      // The page sees the decoded name, which is what the bookmark is scoped
      // under — so the encoding never leaks into the preference key.
      expect(screen.getByTestId("landed-name")).toHaveTextContent("my proj#1");
      expect(readLastPath("my proj#1")).toBe("/project/my%20proj%231/iterm");
    });

    it("resolves the bookmark from the encoded bare route on a desktop", () => {
      writeLastPath("my proj#1", "/project/my%20proj%231/memo");
      installMatchMedia(false);
      renderShell();

      expect(oddLink()).toHaveAttribute("href", "/project/my%20proj%231");
      act(() => {
        fireEvent.click(oddLink());
      });
      expect(screen.getByTestId("landed")).toHaveTextContent(
        "/project/my%20proj%231/memo",
      );
    });
  });
});
