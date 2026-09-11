import { describe, it, expect } from "vitest";

// The guard for the "node" project in vitest.config.ts.
//
// `environmentMatchGlobs` claimed to put these suites in node but vitest 4
// removed the option and ignored it without a word, so they all ran in jsdom.
// Under jsdom Vite resolves browser conditions, and Express 5's `"/{*splat}"`
// catch-all silently stopped matching: `static-frontend`'s deep-link tests
// returned 404 against a product that answers 200 under plain node.
//
// A misconfiguration that changes nothing visible until some unrelated test
// starts lying needs a test of its own. This one fails the moment a server
// suite is handed a DOM again.
describe("server test environment", () => {
  it("runs in node, not jsdom", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
    expect(typeof globalThis.localStorage).toBe("undefined");
  });

  it("resolves packages through node conditions, not browser ones", async () => {
    // The concrete symptom: under browser resolution Express 5's router is a
    // different build and the named-wildcard route stops matching.
    const { default: express } = await import("express");
    const { default: request } = await import("supertest");

    const app = express();
    app.get("/{*splat}", (_req, res) => {
      res.status(200).send("ok");
    });

    const res = await request(app).get("/deep/link/anywhere");
    expect(res.status).toBe(200);
  });
});
