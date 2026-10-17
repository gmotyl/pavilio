import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Where the speech host sits in `App.tsx`, read from the source: mounting the
 * whole app for one structural fact would pull in every route. The host must
 * wrap the notifier (it reads the host) and the routes, and sit inside the
 * router (the provider reads navigate and pathname from it).
 */
const app = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../App.tsx"),
  "utf8",
);

describe("App", () => {
  it("App mounts TerminalSpeechHost above the notifier", () => {
    expect(app).not.toMatch(/<SpeechHostProvider\b/);
    const router = app.indexOf("<BrowserRouter>");
    const open = app.indexOf("<TerminalSpeechHost>");
    const notifier = app.indexOf("<Notifier />");
    const routes = app.indexOf("<Routes>");
    const close = app.indexOf("</TerminalSpeechHost>");
    const routerClose = app.indexOf("</BrowserRouter>");
    expect(router).toBeGreaterThan(-1);
    expect(open).toBeGreaterThan(router);
    expect(notifier).toBeGreaterThan(open);
    expect(routes).toBeGreaterThan(notifier);
    expect(close).toBeGreaterThan(routes);
    expect(routerClose).toBeGreaterThan(close);
  });
});
