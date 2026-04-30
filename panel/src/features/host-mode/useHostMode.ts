import { useEffect, useState } from "react";

// "local" — the panel was opened on the same machine it's running on
// (browser at http://localhost / 127.0.0.1 / [::1]). On WSL setups the
// localhost connection is forwarded into the VM by wslrelay/portproxy;
// from the user's perspective it's still "their machine".
//
// "remote" — opened from a different device (phone via QR pairing, another
// LAN PC, Tailscale peer). The panel is in someone else's view.
//
// The distinction is purely for visual signaling so the user doesn't
// accidentally take a destructive action thinking they're on local when
// they're poking at someone else's panel through a paired peer browser.
// It is NOT used for authorization — that's the mobile_session cookie's
// job.
export type HostMode = "local" | "remote";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function detectHostMode(hostname: string): HostMode {
  return LOCAL_HOSTNAMES.has(hostname.toLowerCase()) ? "local" : "remote";
}

export function useHostMode(): { mode: HostMode; hostname: string } {
  const initial =
    typeof window === "undefined" ? "" : window.location.hostname;
  const [hostname, setHostname] = useState(initial);

  // window.location.hostname can change in single-page apps if the
  // history is replaced cross-origin (rare, but defensible). Re-read on
  // popstate / pushstate.
  useEffect(() => {
    const update = () => setHostname(window.location.hostname);
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  return { mode: detectHostMode(hostname), hostname };
}
