import { existsSync } from "node:fs";
import { join } from "node:path";
import express, { type Express } from "express";

/**
 * Where `vite build` puts hashed chunks inside the bundle (Vite's default
 * `build.assetsDir`). Everything under it is a real file or nothing at all —
 * never an SPA route.
 */
const ASSETS_DIR = "assets";

/**
 * "You forgot to build", not a fault. Its own class so the entry point can
 * print the instruction on its own and keep the stack trace for everything
 * else that can go wrong during startup.
 */
export class MissingFrontendBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingFrontendBundleError";
  }
}

/**
 * Mount the built frontend: hashed assets plus an SPA fallback for deep links.
 * Call AFTER every API router — the fallback is a catch-all.
 * Throws `MissingFrontendBundleError` when `distDir` holds no built bundle.
 */
export function mountStaticFrontend(app: Express, distDir: string): void {
  const shell = join(distDir, "index.html");
  // A dir without index.html is a half-built or emptied bundle, not a bundle:
  // serving it would answer every deep link with a 404 instead of the app.
  if (!existsSync(distDir) || !existsSync(shell)) {
    throw new MissingFrontendBundleError(
      `No built frontend at ${distDir} — run \`pnpm build\` in panel/ first.`,
    );
  }

  app.use(express.static(distDir));

  // Express 5's router rejects a bare "*"; a wildcard needs a name, and the
  // optional-group form also matches "/" itself.
  app.get("/{*splat}", (req, res, next) => {
    // An unknown /api path must 404 rather than answer with the app shell —
    // API routers are mounted before this, so anything left here is unmatched.
    // `/api` itself counts; `/apifoo` does not — that is a legitimate SPA route.
    if (req.path === "/api" || req.path.startsWith("/api/")) {
      next();
      return;
    }
    // Same for the bundle's own asset directory. `vite build` rotates content
    // hashes, so a tab open across a rebuild will ask for a chunk that no
    // longer exists; answering that with the app shell hands JavaScript-
    // expecting code an HTML document ("Unexpected token '<'") instead of a
    // 404 it can recover from.
    if (req.path === `/${ASSETS_DIR}` || req.path.startsWith(`/${ASSETS_DIR}/`)) {
      next();
      return;
    }
    res.sendFile(shell);
  });
}
