import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Login } from "../../features/auth/Login";

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

beforeEach(() => {
  reload = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload },
  });
});

afterEach(() => {
  Object.defineProperty(window, "location", locationDescriptor);
  vi.unstubAllGlobals();
});

async function signIn(ok: boolean): Promise<() => void> {
  const onSuccess = vi.fn();
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
});
