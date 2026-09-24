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
const { writes } = vi.hoisted(() => ({
  writes: [] as Array<{ key: string; value: unknown; scope?: string }>,
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
  useProjects: () => [{ name: "vector", repos: [] }],
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
  useAllTerminalSessions: () => ({ sessions: [], refresh: () => {} }),
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
  });
});
