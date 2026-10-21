/**
 * Shared setup for server route tests: a throwaway projects tree, the
 * express app a router is mounted on, and the factories the usual `vi.mock`
 * calls return.
 *
 * `vi.mock` is hoisted, so this module cannot call it for its importers. Each
 * route test keeps the call and passes one of the factories below:
 *
 *   const projects = withProjectsDir();
 *   vi.mock("../../config", () => configMock(() => projects.dir()));
 *   vi.mock("../../lib/file-index", () => fileIndexMock());
 *
 * The factories run lazily, when the route module first imports the mocked
 * one, and `getConfig` reads the directory at request time — so a `projects`
 * declared below the hoisted call is initialised by the time it is read.
 */
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import express from "express";
import { afterEach, beforeEach, vi } from "vitest";

/**
 * A fresh temp root per test, holding an empty `projects/` directory, removed
 * after the test. `dir()` is the projects directory; `root()` is its parent,
 * for fixtures that must sit outside the projects tree.
 */
export function withProjectsDir(prefix = "pavilio-route-test-"): {
  dir: () => string;
  root: () => string;
} {
  let root = "";
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), prefix));
    mkdirSync(join(root, "projects"));
  });
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });
  return { dir: () => join(root, "projects"), root: () => root };
}

/** An express app with JSON bodies parsed and `router` mounted at `mount`. */
export function makeApp(
  router: express.RequestHandler,
  mount = "/api",
): express.Express {
  const app = express();
  app.use(express.json());
  app.use(mount, router);
  return app;
}

/** `../config` answering with the given projects directory. */
export const configMock = (dir: () => string) => ({
  getConfig: () => ({ projectsDir: dir() }),
});

/** `../lib/file-index` with an empty index and a spy for rebuilds. */
export const fileIndexMock = (): Record<string, unknown> => ({
  getFileIndex: () => [],
  rebuildIndex: vi.fn(),
});
