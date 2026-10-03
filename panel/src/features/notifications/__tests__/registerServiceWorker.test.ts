import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerPanelServiceWorker } from "../registerServiceWorker";

// panel/public/sw.js, four levels above `src/features/notifications/__tests__/`.
const swPath = resolve(__dirname, "../../../../public/sw.js");

/** Installs a fake `navigator.serviceWorker`; jsdom ships none. */
function stubServiceWorker(register: ReturnType<typeof vi.fn>): void {
  Object.defineProperty(navigator, "serviceWorker", {
    value: { register },
    configurable: true,
  });
}

afterEach(() => {
  // Back to jsdom's own navigator, which has no `serviceWorker` at all.
  Reflect.deleteProperty(navigator, "serviceWorker");
  vi.restoreAllMocks();
});

describe("registerPanelServiceWorker", () => {
  it("resolves to null when the browser has no service worker support", async () => {
    expect("serviceWorker" in navigator).toBe(false);
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");

    await expect(registerPanelServiceWorker()).resolves.toBeNull();

    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("registers the worker at the root scope", async () => {
    const registration = { scope: "http://localhost/" } as ServiceWorkerRegistration;
    const register = vi.fn().mockResolvedValue(registration);
    stubServiceWorker(register);

    await expect(registerPanelServiceWorker()).resolves.toBe(registration);

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });

  it("swallows a failed registration and resolves to null", async () => {
    const register = vi.fn().mockRejectedValue(new DOMException("insecure", "SecurityError"));
    stubServiceWorker(register);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(registerPanelServiceWorker()).resolves.toBeNull();
  });

  it("ships a service worker with no fetch handler", () => {
    const source = readFileSync(swPath, "utf-8");

    expect(source).not.toMatch(/addEventListener\(\s*["']fetch["']/);
    expect(source).not.toMatch(/\bonfetch\b/);
    expect(source).not.toMatch(/\bcaches\./);
  });
});
