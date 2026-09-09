import { useEffect, useState, useCallback } from "react";
import type { HostPlatform } from "./setupGuide";

export type TailscaleState =
  | { state: "not_installed" }
  | { state: "not_logged_in" }
  | { state: "off"; selfHost: string }
  | { state: "on"; selfHost: string; url: string; qrUrl: string }
  | {
      state: "error";
      error: string;
      hint?: "https_not_enabled" | "daemon_down";
    };

export type LanChannel =
  | { state: "on"; lanIp: string; url: string; qrUrl: string }
  | { state: "off"; lanIp: string | null };

export interface HostInfo {
  wsl: boolean;
  wslVmIp: string | null;
  platform: HostPlatform;
}

export interface MobileAccessStatus {
  tailscale: TailscaleState;
  lan: LanChannel;
  host: HostInfo;
}

interface Result {
  status: MobileAccessStatus | null;
  refresh: () => Promise<void>;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  rotate: () => Promise<void>;
  enableLan: () => Promise<void>;
  disableLan: () => Promise<void>;
}

export function useMobileAccessStatus(enabled: boolean, pollMs = 2000): Result {
  const [status, setStatus] = useState<MobileAccessStatus | null>(null);

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
        const payload = (await res.json()) as MobileAccessStatus;
        if (payload.tailscale?.state === "error") {
          console.error(`[mobile-access] ${label} returned tailscale error`, payload);
        }
        setStatus(payload);
      } catch (err) {
        console.error(`[mobile-access] ${label} threw`, err);
      }
    },
    [],
  );

  // The explicit recheck buttons force a probe; the poll below takes the server's cached snapshot.
  const refresh = useCallback(
    () => call("refresh", "/api/mobile-access/status?fresh=1"),
    [call],
  );
  const poll = useCallback(
    () => call("poll", "/api/mobile-access/status"),
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
  const rotate = useCallback(
    () => call("rotate", "/api/mobile-access/rotate", { method: "POST" }),
    [call],
  );
  const enableLan = useCallback(
    () => call("enableLan", "/api/mobile-access/lan/enable", { method: "POST" }),
    [call],
  );
  const disableLan = useCallback(
    () => call("disableLan", "/api/mobile-access/lan/disable", { method: "POST" }),
    [call],
  );

  useEffect(() => {
    if (!enabled) return;
    let id: ReturnType<typeof setTimeout>;
    const schedule = () => {
      id = setTimeout(() => {
        void poll().then(schedule);
      }, pollMs);
    };
    void poll();
    schedule();
    return () => clearTimeout(id);
  }, [enabled, poll, pollMs]);

  return { status, refresh, enable, disable, rotate, enableLan, disableLan };
}
