// The git-environment strip is shared with the node project and must run before
// any fixture can spawn git — imported first, for its side effect.
import "../test-setup.node.js";

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/**
 * Imported lazily, from inside the hook: a static import at the top of this file
 * would load the module before a suite's own `vi.mock` is registered, so a suite
 * that stubs the realtime channel would end up with the real one wired into the
 * store instead.
 */
async function reset(specifier: string, name: string): Promise<void> {
  const mod: Record<string, unknown> = await import(/* @vite-ignore */ specifier);
  // A stubbed module exports only what its suite needs, and vitest's mocked
  // namespace throws rather than returning undefined for anything else.
  if (!(name in mod)) return;
  (mod[name] as () => void)();
}

async function resetTabScopedSingletons(): Promise<void> {
  // Store first, mirroring the dependency: the store subscribes to the channel,
  // never the reverse. Order is not load-bearing while both run in the same hook
  // — whichever goes second re-clears — but it keeps this reading the same way
  // round as the teardown a suite would write by hand.
  await reset("./features/terminal/sessionStore", "__resetSessionStoreForTests");
  await reset("./features/realtime/channel", "__resetRealtimeChannelForTests");
}

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

afterEach(async () => {
  cleanup();
  // The channel and the session store are tab-scoped singletons that start on
  // first use and never stop, so any suite rendering a consumer used to leave
  // the channel's watchdog interval, its visibilitychange listener and the
  // store's poll armed past the end of the file — a full-suite run once died on
  // a reconnect timeout firing into an unrelated suite.
  await resetTabScopedSingletons();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});
