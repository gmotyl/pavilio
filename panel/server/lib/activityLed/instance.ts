// The panel's one activity LED reporter, built from the real terminal activity,
// preferences and a UDP socket. Routes and shutdown reach it through here.

import { createSocket, type Socket } from "node:dgram";
import { machineId } from "../hostname.js";
import { getPreferences } from "../preferences-store.js";
import { getSnapshot, subscribe } from "../terminalActivity.js";
import { normaliseSettings, startActivityLed, type ActivityLed } from "./index.js";

let current: ActivityLed | null = null;
let socket: Socket | null = null;

// Created on first send, so a disabled reporter never opens a socket.
function udpSend(buf: Buffer, host: string, port: number): Promise<void> {
  if (!socket) {
    socket = createSocket("udp4");
    socket.on("error", () => {});
    socket.unref();
  }
  const s = socket;
  return new Promise((resolve, reject) => {
    s.send(buf, port, host, (err) => (err ? reject(err) : resolve()));
  });
}

export function startPanelActivityLed(): ActivityLed {
  if (current) return current;
  current = startActivityLed({
    getSnapshot,
    subscribe,
    getSettings: () => normaliseSettings(getPreferences().activityLed),
    machineId: machineId(),
    send: udpSend,
    log: (msg) => console.warn(`[activity-led] ${msg}`),
  });
  return current;
}

export function getActivityLed(): ActivityLed | null {
  return current;
}

export function stopPanelActivityLed(): void {
  current?.stop();
  current = null;
  socket?.close();
  socket = null;
}

export function _setActivityLedForTests(led: ActivityLed | null): void {
  current = led;
}
