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
  const res = await fetch("/api/mobile-access/status", { credentials: "include" });
  return res.ok;
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
        setPhase("paired");
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
  if (phase === "gate") return <PairingGate onRetry={() => setPhase("checking")} />;
  return <div className="min-h-screen flex items-center justify-center">Checking pairing…</div>;
}
