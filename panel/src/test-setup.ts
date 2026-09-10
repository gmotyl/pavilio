import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { GIT_LOCATION_VARS } from "../server/lib/gitEnv.js";

// Git picks its repository from the environment before it looks at cwd, and it
// exports these to every hook — absolute, in a linked worktree. Inherited, they
// make each fixture's `git init` / `git commit` operate on the real repository
// instead of the mkdtemp sandbox it just built, however carefully the fixture
// passes cwd. A suite run from a pre-push hook did exactly that: it reinitialised
// the shared clone as bare and pushed fixture history over main.
//
// Stripping them here rather than in the individual suites keeps every present
// and future test hermetic about which repository it touches, without each one
// having to remember. Done at import time, before any fixture can spawn git.
for (const name of GIT_LOCATION_VARS) delete process.env[name];

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

const storage = createMemoryStorage();
// sessionStorage needs its own independent store — jsdom's real one otherwise
// leaks across tests in a file (e.g. panel:lastFile:*), making order-dependent
// assertions flaky.
const sessionStorageMock = createMemoryStorage();

Object.defineProperty(globalThis, "localStorage", {
  value: storage,
  configurable: true,
});

Object.defineProperty(window, "localStorage", {
  value: storage,
  configurable: true,
});

Object.defineProperty(globalThis, "sessionStorage", {
  value: sessionStorageMock,
  configurable: true,
});

Object.defineProperty(window, "sessionStorage", {
  value: sessionStorageMock,
  configurable: true,
});

// jsdom does not implement scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});
