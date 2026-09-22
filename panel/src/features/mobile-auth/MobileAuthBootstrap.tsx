import { useEffect, useState, type ReactNode } from "react";
import { PairingGate } from "./PairingGate";

type Phase = "checking" | "paired" | "gate";

function isLocalHost(): boolean {
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

async function tryExchangeFragment(): Promise<boolean> {
  const hash = window.location.hash;
  const m = hash.match(/[#&]mt=([A-Za-z0-9_-]+)/);
  if (!m) return false;
  const token = m[1];
  const res = await fetch("/api/auth/mobile-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
    credentials: "include",
  });
  if (!res.ok) return false;
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  return true;
}

async function probeSession(): Promise<boolean> {
  // `/api/auth/status` is public (bypasses auth middleware) and its
  // `authenticated` field reflects *either* a valid panel_token or a valid
  // mobile_session. This works for both Tailscale and LAN peers — unlike
  // `/api/mobile-access/status` which is loopback-only and 403s LAN peers
  // on refresh, falsely tripping the pairing gate.
  const res = await fetch("/api/auth/status", { credentials: "include" });
  if (!res.ok) return false;
  try {
    const body = (await res.json()) as { authenticated?: boolean };
    return body.authenticated === true;
  } catch {
    return false;
  }
}

export function MobileAuthBootstrap({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>(isLocalHost() ? "paired" : "checking");

  useEffect(() => {
    if (phase !== "checking") return;
    let cancelled = false;
    (async () => {
      const exchanged = await tryExchangeFragment();
      if (cancelled) return;
      if (exchanged) {
        // Reload rather than `setPhase("paired")`. This document was fetched
        // *before* the cookie existed, and `server/middleware/mobile-auth.ts`
        // 401s every non-loopback `/api/*` without one — so the blocking
        // `GET /api/preferences.js` in index.html 401'd and both injected
        // globals are undefined. Mounting the app on it would leave the
        // preference store reading every portable value as its declared
        // default and silently dropping every portable write, for the whole
        // session. Only a reload re-runs a parser-blocking script, this time
        // with the cookie. The phase stays "checking" until it lands.
        window.location.reload();
        return;
      }
      const ok = await probeSession();
      if (cancelled) return;
      setPhase(ok ? "paired" : "gate");
    })();
    return () => {
      cancelled = true;
    };
  }, [phase]);

  if (phase === "paired") return <>{children}</>;
  // Retry by reloading, for the same reason the exchange does: the gate is only
  // ever shown on a document whose preferences script already 401'd, so any
  // session adopted from here has to come with a fresh page load.
  if (phase === "gate") return <PairingGate onRetry={() => window.location.reload()} />;
  return <div className="min-h-screen flex items-center justify-center">Checking pairing…</div>;
}
