import { act, fireEvent, render, type RenderOptions } from "@testing-library/react";
import { MemoryRouter, type MemoryRouterProps } from "react-router-dom";
import { ActiveFileProvider } from "./features/explorer/useActiveFile";
import { MOBILE_QUERY } from "./lib/breakpoints";
import { vi } from "vitest";
import type { ReactElement } from "react";

interface RouterRenderOptions extends RenderOptions {
  initialEntries?: MemoryRouterProps["initialEntries"];
}

export function renderWithRouter(
  ui: ReactElement,
  options: RouterRenderOptions = {},
) {
  const { initialEntries = ["/"], ...renderOptions } = options;
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ActiveFileProvider>{ui}</ActiveFileProvider>
    </MemoryRouter>,
    renderOptions,
  );
}

type FetchMap = Record<string, unknown>;

export function mockFetchResponses(map: FetchMap) {
  const mockFetch = vi.fn((input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    for (const [pattern, data] of Object.entries(map)) {
      if (url.includes(pattern)) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(data),
        } as Response);
      }
    }
    return Promise.resolve({
      ok: false,
      json: () => Promise.resolve({}),
    } as Response);
  });
  vi.stubGlobal("fetch", mockFetch);
  return mockFetch;
}

type MediaListener = (e: MediaQueryListEvent) => void;

export interface MatchMediaOptions {
  /** Whether the phone breakpoint (`MOBILE_QUERY`) matches at install. */
  mobile?: boolean;
}

/**
 * Install a `window.matchMedia` jsdom lacks: only `MOBILE_QUERY` can match, and
 * only while `mobile` is set. Every list it returns shares one
 * listener set — both the modern and the deprecated listener pair feed it, so a
 * caller using the legacy form is not silently left unnotified — and
 * `setMobile` flips the breakpoint and notifies inside `act`.
 */
export function installMatchMedia({ mobile = false }: MatchMediaOptions = {}) {
  const listeners = new Set<MediaListener>();
  let current = mobile;
  const list = (query: string) => ({
    get matches() {
      return current && query === MOBILE_QUERY;
    },
    media: query,
    addEventListener: (_: string, cb: MediaListener) => listeners.add(cb),
    removeEventListener: (_: string, cb: MediaListener) => listeners.delete(cb),
    addListener: (cb: MediaListener) => listeners.add(cb),
    removeListener: (cb: MediaListener) => listeners.delete(cb),
  });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: list,
  });
  return {
    setMobile(next: boolean) {
      current = next;
      act(() => {
        listeners.forEach((cb) =>
          cb({ matches: next, media: MOBILE_QUERY } as MediaQueryListEvent),
        );
      });
    },
  };
}

/**
 * A `ResizeObserver` jsdom lacks, that never fires. Every observed element is
 * recorded in `StubResizeObserver.observed` — clear it in `beforeEach` when a
 * suite reads it.
 */
export class StubResizeObserver {
  static readonly observed: Element[] = [];
  observe(element: Element): void {
    StubResizeObserver.observed.push(element);
  }
  unobserve(): void {}
  disconnect(): void {}
}

/** Press `handle`, move the pointer `dx` pixels and let go. */
export function dragBy(
  handle: HTMLElement,
  dx: number,
  { from = 600, pointerId = 1 }: { from?: number; pointerId?: number } = {},
) {
  fireEvent.pointerDown(handle, { pointerId, clientX: from });
  fireEvent.pointerMove(handle, { pointerId, clientX: from + dx });
  fireEvent.pointerUp(handle, { pointerId, clientX: from + dx });
}

/** Answers a request by hand; anything else in a route table is a JSON body. */
export type FetchHandler = (
  url: string,
  init?: RequestInit,
) => Response | Promise<Response>;

/** A 200 JSON `Response` carrying `body`. */
export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function answer(route: unknown, url: string, init?: RequestInit) {
  return typeof route === "function"
    ? (route as FetchHandler)(url, init)
    : jsonResponse(route);
}

/**
 * Stub the global `fetch`. `overrides` maps a URL fragment to a JSON body or a
 * `FetchHandler`; the first key the URL contains wins (insertion order), and
 * anything unmatched gets `fallback` (a JSON body, or a handler). Returns the
 * mock so a suite can assert on its calls.
 */
export function stubFetch(
  overrides: Record<string, unknown> = {},
  fallback: unknown = null,
) {
  const mock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    for (const [fragment, route] of Object.entries(overrides)) {
      if (url.includes(fragment)) return answer(route, url, init);
    }
    return answer(fallback, url, init);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}
