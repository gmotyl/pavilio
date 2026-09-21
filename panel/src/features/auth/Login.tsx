import { useState } from "react";

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    let signedIn = false;
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      signedIn = res.ok;
      if (!signedIn) setError("Invalid token");
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
    if (!signedIn) return;

    // Outside the `try` on purpose, and before `onSuccess`. `GET
    // /api/preferences.js` sits behind the same auth, so the blocking script in
    // index.html already 401'd on this page load and both injected globals are
    // undefined — which makes the preference store suppress every portable
    // write for the rest of the session. Only a reload re-runs a
    // parser-blocking script, this time with the cookie. `onSuccess` is the
    // shell's async `recheck`: a throw from it inside the `try` above used to
    // be reported as "Network error" *instead of* reloading, leaving exactly
    // the write-suppressed session the reload exists to prevent.
    window.location.reload();
    try {
      onSuccess();
    } catch {
      // The reload is already on its way, and nothing this page does now
      // survives it — the fresh document re-runs the check for itself.
    }
  };

  return (
    <div
      className="flex items-center justify-center min-h-screen"
      style={{ background: "var(--bg-base)" }}
    >
      <form
        onSubmit={submit}
        className="p-8 rounded-xl space-y-4 w-full max-w-sm"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <h1 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          Panel Access
        </h1>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Enter your panel token to continue.
        </p>
        <input
          type="password"
          autoFocus
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="token"
          className="w-full px-3 py-2 rounded-md text-sm outline-none"
          style={{
            background: "var(--bg-base)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-subtle)",
          }}
        />
        {error && (
          <div className="text-xs" style={{ color: "var(--red, #f7768e)" }}>
            {error}
          </div>
        )}
        <button
          type="submit"
          data-testid="login-submit"
          disabled={submitting || token.length === 0}
          className="w-full px-4 py-2 rounded-md text-sm font-medium transition-opacity disabled:opacity-50"
          style={{ background: "var(--accent, #f0c674)", color: "#1a1b26" }}
        >
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}

export default Login;
