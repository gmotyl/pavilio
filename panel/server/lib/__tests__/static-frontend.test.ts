import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MissingFrontendBundleError,
  mountStaticFrontend,
} from "../static-frontend.js";

const SHELL = "<!doctype html><title>panel shell</title>";

let tmpRoot = "";
let distDir = "";

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "pavilio-static-frontend-"));
  distDir = join(tmpRoot, "dist");
  mkdirSync(join(distDir, "assets"), { recursive: true });
  writeFileSync(join(distDir, "index.html"), SHELL);
  writeFileSync(join(distDir, "assets", "app-abc123.js"), "console.log(1);\n");
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("mountStaticFrontend", () => {
  it("throws naming the build command when the bundle directory is absent", () => {
    const missing = join(tmpRoot, "nope");
    expect(() => mountStaticFrontend(express(), missing)).toThrow(missing);
    expect(() => mountStaticFrontend(express(), missing)).toThrow("pnpm build");
    // Its own class: the serving entry prints this one without a stack.
    expect(() => mountStaticFrontend(express(), missing)).toThrow(
      MissingFrontendBundleError,
    );
  });

  it("throws when the bundle directory has no index.html", () => {
    rmSync(join(distDir, "index.html"));
    expect(() => mountStaticFrontend(express(), distDir)).toThrow(distDir);
    expect(() => mountStaticFrontend(express(), distDir)).toThrow("pnpm build");
  });

  it("serves the app shell for a deep link", async () => {
    const app = express();
    mountStaticFrontend(app, distDir);
    const res = await request(app).get("/project/pavilio/iterm");
    expect(res.status).toBe(200);
    expect(res.text).toBe(SHELL);
  });

  it("leaves a route registered before the mount untouched", async () => {
    const app = express();
    app.get("/api/system", (_req, res) => {
      res.json({ ok: true });
    });
    mountStaticFrontend(app, distDir);
    const res = await request(app).get("/api/system");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("404s an unknown /api path instead of serving the app shell", async () => {
    const app = express();
    mountStaticFrontend(app, distDir);
    const res = await request(app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.text).not.toBe(SHELL);
  });

  it("404s a missing hashed asset instead of serving the app shell", async () => {
    const app = express();
    mountStaticFrontend(app, distDir);
    const res = await request(app).get("/assets/app-OLDHASH.js");
    expect(res.status).toBe(404);
    expect(res.text).not.toBe(SHELL);
  });

  it("still serves an asset that exists", async () => {
    const app = express();
    mountStaticFrontend(app, distDir);
    const res = await request(app).get("/assets/app-abc123.js");
    expect(res.status).toBe(200);
    expect(res.text).toBe("console.log(1);\n");
  });

  it("404s exactly /api", async () => {
    const app = express();
    mountStaticFrontend(app, distDir);
    const res = await request(app).get("/api");
    expect(res.status).toBe(404);
    expect(res.text).not.toBe(SHELL);
  });

  it("still serves the app shell for a path merely starting with api", async () => {
    const app = express();
    mountStaticFrontend(app, distDir);
    const res = await request(app).get("/apifoo");
    expect(res.status).toBe(200);
    expect(res.text).toBe(SHELL);
  });
});
