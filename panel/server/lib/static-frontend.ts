import { existsSync } from "node:fs";
import { join } from "node:path";
import express, { type Express } from "express";

/**
 * Mount the built frontend: hashed assets plus an SPA fallback for deep links.
 * Call AFTER every API router — the fallback is a catch-all.
 * Throws when `distDir` holds no built bundle.
 */
export function mountStaticFrontend(app: Express, distDir: string): void {
  const shell = join(distDir, "index.html");
  // A dir without index.html is a half-built or emptied bundle, not a bundle:
  // serving it would answer every deep link with a 404 instead of the app.
  if (!existsSync(distDir) || !existsSync(shell)) {
    throw new Error(
      `No built frontend at ${distDir} — run \`pnpm build\` in panel/ first.`,
    );
  }

  app.use(express.static(distDir));

  // Express 5's router rejects a bare "*"; a wildcard needs a name, and the
  // optional-group form also matches "/" itself.
  app.get("/{*splat}", (req, res, next) => {
    // An unknown /api path must 404 rather than answer with the app shell —
    // API routers are mounted before this, so anything left here is unmatched.
    if (req.path.startsWith("/api/")) {
      next();
      return;
    }
    res.sendFile(shell);
  });
}
