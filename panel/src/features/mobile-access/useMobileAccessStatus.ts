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

export function useMobileAccessStatus(enabled: boolean): Result {
  const [status, setStatus] = useState<MobileAccessState | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/mobile-access/status");
    if (!res.ok) return;
    setStatus(await res.json());
  }, []);

  const enable = useCallback(async () => {
    const res = await fetch("/api/mobile-access/enable", { method: "POST" });
    if (!res.ok) return;
    setStatus(await res.json());
  }, []);

  const disable = useCallback(async () => {
    const res = await fetch("/api/mobile-access/disable", { method: "POST" });
    if (!res.ok) return;
    setStatus(await res.json());
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let id: ReturnType<typeof setTimeout>;
    const schedule = () => {
      id = setTimeout(() => {
        void refresh().then(schedule);
      }, 2000);
    };
    void refresh();
    schedule();
    return () => clearTimeout(id);
  }, [enabled, refresh]);

  return { status, refresh, enable, disable };
}
