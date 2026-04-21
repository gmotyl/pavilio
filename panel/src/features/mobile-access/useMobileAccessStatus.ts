import { useEffect, useState, useCallback } from "react";

export type MobileAccessState =
  | { state: "not_installed" }
  | { state: "not_logged_in" }
  | { state: "off"; selfHost: string }
  | { state: "on"; selfHost: string; url: string; qrUrl: string }
  | { state: "error"; error: string; hint?: "https_not_enabled" };

interface Result {
  status: MobileAccessState | null;
  refresh: () => Promise<void>;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
}

export function useMobileAccessStatus(enabled: boolean, pollMs = 2000): Result {
  const [status, setStatus] = useState<MobileAccessState | null>(null);

  const call = useCallback(
    async (label: string, url: string, init?: RequestInit) => {
      try {
        const res = await fetch(url, init);
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          console.error(
            `[mobile-access] ${label} failed: HTTP ${res.status} ${res.statusText}`,
            body,
          );
          return;
        }
        const payload = (await res.json()) as MobileAccessState;
        if (payload.state === "error") {
          console.error(`[mobile-access] ${label} returned error state`, payload);
        }
        setStatus(payload);
      } catch (err) {
        console.error(`[mobile-access] ${label} threw`, err);
      }
    },
    [],
  );

  const refresh = useCallback(
    () => call("refresh", "/api/mobile-access/status"),
    [call],
  );
  const enable = useCallback(
    () => call("enable", "/api/mobile-access/enable", { method: "POST" }),
    [call],
  );
  const disable = useCallback(
    () => call("disable", "/api/mobile-access/disable", { method: "POST" }),
    [call],
  );

  useEffect(() => {
    if (!enabled) return;
    let id: ReturnType<typeof setTimeout>;
    const schedule = () => {
      id = setTimeout(() => {
        void refresh().then(schedule);
      }, pollMs);
    };
    void refresh();
    schedule();
    return () => clearTimeout(id);
  }, [enabled, refresh, pollMs]);

  return { status, refresh, enable, disable };
}
