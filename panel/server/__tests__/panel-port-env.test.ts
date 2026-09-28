import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * `PANEL_PORT` used to be a lie. `scripts/panel` honoured it, the Windows
 * launcher honoured it, and the server never read it at all: the port came from
 * `panel.config.local.ts` and nothing else. With 3010 already taken the panel
 * then auto-incremented to 3011, while `scripts/panel start` waited out its
 * timeout on 3010 and `scripts/panel stop` went on looking for a panel that was
 * never there — a running process nothing could manage.
 *
 * So the variable is real now, in the same place and style as the TLS overrides
 * next to it, and `isPortExplicit()` is how the rest of the server knows the
 * difference between a port that was *asked for* and one that was merely
 * configured. Only the latter may be auto-incremented.
 */

let saved: string | undefined;

/** A fresh import of config.js — it caches the loaded document in module state. */
async function freshConfig() {
  vi.resetModules();
  return import("../config.js");
}

/** The port the panel resolves to with no PANEL_PORT in the environment. */
async function baselinePort(): Promise<number> {
  delete process.env.PANEL_PORT;
  const { loadConfig } = await freshConfig();
  return (await loadConfig()).port;
}

beforeEach(() => {
  saved = process.env.PANEL_PORT;
  delete process.env.PANEL_PORT;
});

afterEach(() => {
  if (saved === undefined) delete process.env.PANEL_PORT;
  else process.env.PANEL_PORT = saved;
});

describe("PANEL_PORT", () => {
  it("leaves the configured port alone when it is not set", async () => {
    const { loadConfig, isPortExplicit } = await freshConfig();
    const config = await loadConfig();

    expect(config.port).toBeGreaterThan(0);
    // Nothing asked for this port, so the auto-increment stays allowed.
    expect(isPortExplicit()).toBe(false);
  });

  it("overrides the configured port, and marks it as explicitly requested", async () => {
    const baseline = await baselinePort();
    const wanted = baseline + 7;
    process.env.PANEL_PORT = String(wanted);

    const { loadConfig, isPortExplicit, getConfig } = await freshConfig();
    const config = await loadConfig();

    expect(config.port).toBe(wanted);
    expect(getConfig().port).toBe(wanted);
    expect(isPortExplicit()).toBe(true);
  });

  it("tolerates surrounding whitespace, the way an env file writes it", async () => {
    const baseline = await baselinePort();
    process.env.PANEL_PORT = `  ${baseline + 9} `;

    const { loadConfig, isPortExplicit } = await freshConfig();

    expect((await loadConfig()).port).toBe(baseline + 9);
    expect(isPortExplicit()).toBe(true);
  });

  it("ignores a value that is not a usable port rather than binding nonsense", async () => {
    const baseline = await baselinePort();

    // Every one of these is a port the operator cannot have meant. Falling back
    // to the configured port is right; `Number("")` is 0 and would otherwise
    // hand the OS an ephemeral port nobody could find.
    for (const bad of ["", "   ", "0", "-1", "65536", "3010x", "abc", "30.10"]) {
      process.env.PANEL_PORT = bad;
      const { loadConfig, isPortExplicit } = await freshConfig();

      expect((await loadConfig()).port, `PANEL_PORT=${JSON.stringify(bad)}`).toBe(baseline);
      // …and it is NOT an explicit request, so the auto-increment still applies:
      // an unreadable value must not also disable the fallback that works.
      expect(isPortExplicit(), `PANEL_PORT=${JSON.stringify(bad)}`).toBe(false);
    }
  });
});
