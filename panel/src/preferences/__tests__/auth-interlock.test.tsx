import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Login } from "../../features/auth/Login";
import { MobileAuthBootstrap } from "../../features/mobile-auth/MobileAuthBootstrap";

/**
 * The other half of the write interlock, and the reason it can be temporary.
 *
 * `GET /api/preferences.js` sits behind `authMiddleware`, so on a
 * `PANEL_TOKEN`-protected panel the blocking script in `index.html` 401s and
 * both injected globals stay undefined. The store then refuses every portable
 * write (see `store.test.ts`), which keeps the stored file safe but leaves the
 * session on defaults forever — unless signing in re-fetches the script.
 * Only a reload can do that: the script is a parser-blocking `<script src>`,
 * and the document has already been parsed.
 *
 * It lives beside the store tests rather than under `features/auth/` because
 * what it pins is the preferences contract, not the login form.
 */
const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location")!;
let reload: ReturnType<typeof vi.fn>;

/**
 * A stand-in `window.location` whose `reload` can be observed. The fields are
 * spelt out rather than spread off the real one: jsdom keeps them on the
 * prototype, so a spread hands back an object with no `hostname` at all and
 * `MobileAuthBootstrap` would read every host as a non-local one.
 */
function stubLocation(extra: Record<string, unknown> = {}): void {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      href: "http://localhost/",
      hostname: "localhost",
      pathname: "/",
      search: "",
      hash: "",
      reload,
      ...extra,
    },
  });
}

beforeEach(() => {
  reload = vi.fn();
  stubLocation();
});

afterEach(() => {
  Object.defineProperty(window, "location", locationDescriptor);
  vi.unstubAllGlobals();
});

async function signIn(
  ok: boolean,
  onSuccess: () => void = vi.fn(),
): Promise<() => void> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: ok ? 200 : 401 })),
  );

  render(<Login onSuccess={onSuccess} />);
  fireEvent.change(screen.getByPlaceholderText("token"), { target: { value: "s3cret" } });
  fireEvent.click(screen.getByTestId("login-submit"));

  return onSuccess;
}

describe("signing in", () => {
  it("signing in reloads so the preferences script is re-fetched", async () => {
    await signIn(true);

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it("a rejected token does not reload", async () => {
    await signIn(false);

    await screen.findByText("Invalid token");
    expect(reload).not.toHaveBeenCalled();
  });

  it("a throwing onSuccess does not cost the reload", async () => {
    // `onSuccess` is the shell's `recheck` — an async probe of `/api/auth/status`
    // that can reject. Called inside the same `try` as the reload, its throw is
    // swallowed as "Network error" and the reload never runs, leaving exactly
    // the write-suppressed session the reload exists to prevent.
    const onSuccess = vi.fn(() => {
      throw new Error("recheck blew up");
    });

    await signIn(true, onSuccess);

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Network error")).toBeNull();
  });

  it("a REJECTING onSuccess is not an unhandled rejection", async () => {
    // `recheck` is async, so its failure is a rejected promise — which the
    // synchronous `catch` around the call cannot see. Swallowing it explicitly
    // rather than awaiting it: the reload is already on its way, and awaiting
    // would reintroduce the ordering the reload is placed first to prevent.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      // A plain function, NOT a `vi.fn`: vitest's spy wrapper attaches its own
      // `.then` to a returned promise to record the settled result, which
      // counts as handling the rejection and would make this pass vacuously.
      const onSuccess = () => Promise.reject(new Error("recheck blew up"));

      await signIn(true, onSuccess);

      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

/**
 * The same interlock at the entry point a phone actually uses.
 *
 * `server/middleware/mobile-auth.ts` 401s every non-loopback `/api/*` without a
 * session cookie, so a phone opening `https://<host>.ts.net/#mt=<token>` loads a
 * document whose blocking `/api/preferences.js` 401'd. Exchanging the pairing
 * token in place then mounts the whole app on that unauthenticated document:
 * both globals stay undefined, every portable read answers the declared default
 * and every portable write is dropped, for the rest of the session. Only a
 * reload re-runs the parser-blocking script, this time with the cookie.
 */
describe("mobile pairing", () => {
  function renderBootstrap() {
    return render(
      <MobileAuthBootstrap>
        <div>app</div>
      </MobileAuthBootstrap>,
    );
  }

  it("a successful pairing exchange reloads instead of mounting the app", async () => {
    stubLocation({ hostname: "mac.tail.ts.net", hash: "#mt=ABC123" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );

    renderBootstrap();

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    // And the app is NOT mounted on the document that 401'd: every hook in it
    // would read its preference through a global that is still undefined.
    expect(screen.queryByText("app")).toBeNull();
  });

  it("a rejected pairing token does not reload", async () => {
    stubLocation({ hostname: "mac.tail.ts.net", hash: "#mt=NOPE" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "/api/auth/mobile-login"
          ? new Response("{}", { status: 401 })
          : new Response(JSON.stringify({ authenticated: false }), { status: 200 }),
      ),
    );

    renderBootstrap();

    await screen.findByText(/scan a fresh QR/i);
    expect(reload).not.toHaveBeenCalled();
  });

  it("retrying from the pairing gate reloads rather than re-probing in place", async () => {
    // The gate is only ever shown on a document that already 401'd, so the
    // session it is waiting for cannot be adopted without a fresh page load.
    stubLocation({ hostname: "mac.tail.ts.net" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ authenticated: false }), { status: 200 })),
    );

    renderBootstrap();

    fireEvent.click(await screen.findByTestId("pairing-gate-retry"));

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });
});
