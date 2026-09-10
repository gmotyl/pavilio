import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { resolve } from "path";
import { createServer as createHttpServer, type Server as HttpServer } from "http";
import { createServer as createHttpsServer } from "https";
import { createServer as createNetServer } from "net";
import { readFileSync } from "fs";
import { loadConfig, getConfig } from "./config.js";
import {
  authMiddleware,
  loginHandler,
  logoutHandler,
  statusHandler,
} from "./lib/auth.js";
import { loadAuthState } from "./lib/mobile-auth.js";
import { mobileAuthMiddleware } from "./middleware/mobile-auth.js";
import authMobileRouter from "./routes/auth-mobile.js";
import mobileAccessRouter from "./routes/mobile-access.js";
import projectsRouter from "./routes/projects.js";
import { rebuildIndex } from "./lib/file-index.js";
import filesRouter from "./routes/files.js";
import gitRouter from "./routes/git.js";
import agentsRouter from "./routes/agents.js";
import searchRouter from "./routes/search.js";
import imagesRouter from "./routes/images.js";
import agentSettingsRouter from "./routes/agent-settings.js";
import terminalRouter from "./routes/terminal.js";
import scriptsRouter from "./routes/scripts.js";
import { mountTimeRoutes } from "./routes/time.js";
import autoSyncRouter from "./routes/auto-sync.js";
import systemRouter from "./routes/system.js";
import speechRouter, { MAX_UTTERANCE_BYTES } from "./routes/speech.js";
import archiveRouter from "./routes/archive.js";
import { machineHostname } from "./lib/hostname.js";
import { startScheduler } from "./lib/autoSyncScheduler.js";
import { isEnabled } from "./lib/autoSyncState.js";
import { setupWebSocket, setupFileWatcher, getWss } from "./watcher.js";
import { pruneDeadAgents } from "./lib/agent-registry.js";
import { registerPanelServer } from "./lib/panel-listener.js";
import { sweepNames } from "./lib/terminal-identity.js";
import { listSessions } from "./lib/terminal-manager.js";
import { listOsUsers } from "./lib/os-users.js";

/**
 * First port in `start..start+span-1` nothing else is listening on. Shared by
 * both entries — the serving entry needs one for the panel itself, the dev
 * entry needs a second one for Vite's HMR socket.
 */
export async function findFreePort(start: number, span = 50): Promise<number> {
  for (let candidate = start; candidate < start + span; candidate++) {
    const free = await new Promise<boolean>((resolve) => {
      const probe = createNetServer();
      probe.once("error", () => resolve(false));
      probe.listen(candidate, "127.0.0.1", () => {
        probe.close(() => resolve(true));
      });
    });
    if (free) return candidate;
  }
  throw new Error(`No free port in ${start}..${start + span - 1}`);
}

/**
 * Assemble and start the panel. The only thing left to the caller is how the
 * frontend is served: `mountFrontend` is invoked after every API router and
 * before `listen()` — the slot `app.use(vite.middlewares)` used to occupy.
 *
 * Keep that position. It is not a security boundary — `authMiddleware` and
 * `mobileAuthMiddleware` both 401 only `/api/` paths and `next()` everything
 * else, so the frontend is reachable unauthenticated either way (deliberately:
 * the Login page has to render). What the position buys is precedence: the
 * frontend mount ends in a catch-all SPA fallback, so anything registered
 * after it never sees a request.
 */
export async function startPanel(
  mountFrontend: (app: Express) => void | Promise<void>,
): Promise<void> {
  await loadConfig();
  await loadAuthState();
  rebuildIndex();
  const { port: configuredPort, tlsCert, tlsKey } = getConfig();
  const port = await findFreePort(configuredPort);
  if (port !== configuredPort) {
    console.log(`Port ${configuredPort} in use, using ${port} instead.`);
  }

  const app = express();

  let server: HttpServer;
  if (tlsCert && tlsKey) {
    server = createHttpsServer(
      { cert: readFileSync(tlsCert), key: readFileSync(tlsKey) },
      app
    );
  } else {
    server = createHttpServer(app);
  }

  // The speech route owns its own body cap, so its parser has to run before the
  // global one: body-parser skips a request whose stream it finds already
  // finished, so whichever parser reads the body first is the one whose `limit`
  // governs. Scoped to the speech path, so every other route is still parsed by
  // the global `express.json()` below at its default limit. This changes no
  // security boundary — `express.json()` already ran here, ahead of
  // `authMiddleware`, before this line existed.
  app.use("/api/speech", express.json({ limit: MAX_UTTERANCE_BYTES }));
  // Reachable only from the parser directly above: an error thrown by a later
  // layer (the speech router itself) resumes past this one and never sees it.
  // That is exactly the scope wanted — it turns the over-limit throw into JSON
  // instead of express's default HTML error page, without becoming the panel's
  // de facto global error handler.
  app.use("/api/speech", (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if ((err as { type?: string } | null)?.type === "entity.too.large") {
      res.status(413).json({ error: "utterance too large", limit: MAX_UTTERANCE_BYTES });
      return;
    }
    next(err);
  });

  app.use(express.json());
  app.use(mobileAuthMiddleware);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/auth/login", loginHandler);
  app.post("/api/auth/logout", logoutHandler);
  app.get("/api/auth/status", statusHandler);
  app.use(authMiddleware);

  app.use("/api/auth", authMobileRouter);
  app.use("/api/mobile-access", mobileAccessRouter);

  app.use("/api/projects", projectsRouter);
  app.use("/api/files", filesRouter);
  app.use("/api/git", gitRouter);
  app.use("/api/agents", agentsRouter);
  app.use("/api/search", searchRouter);
  app.use("/api/images", imagesRouter);
  app.use("/api/agent-settings", agentSettingsRouter);
  app.use("/api/terminal", terminalRouter);
  app.use("/api/auto-sync", autoSyncRouter);
  app.use("/api/archive", archiveRouter);
  app.use("/api/system", systemRouter);
  app.use("/api/speech", speechRouter);
  app.use("/api", scriptsRouter);
  mountTimeRoutes(app, { projectsDir: getConfig().projectsDir, hostname: machineHostname() });

  await mountFrontend(app);

  // Sessions don't survive a restart, so every identity file left on disk at
  // boot belongs to a session that's already gone — sweep them now. Deferred
  // until the frontend has mounted because the sweep is destructive and
  // mountFrontend is the last startup step that can still fail (a missing
  // bundle): a `pnpm start` that aborts there must not delete the terminal
  // names of a panel already running in another process. Nothing between
  // here and the top of startPanel() reads the identity files.
  sweepNames(listSessions().map((s) => s.id));

  // Eager discovery so the first /api/terminal/os-users (or session-create)
  // request never pays the /etc/passwd read cost; listOsUsers() never throws.
  listOsUsers();

  const protocol = tlsCert && tlsKey ? "https" : "http";
  server.listen(port, "127.0.0.1", () => {
    console.log(`Panel bound to ${protocol}://127.0.0.1:${port} (loopback only)`);
  });

  setupWebSocket(server);
  registerPanelServer(server, port, getWss);
  setupFileWatcher();

  setInterval(pruneDeadAgents, 30_000);

  if (isEnabled()) {
    const c = getConfig();
    const autoSync = c.autoSync ?? { intervalMinutes: 15, dataPaths: ["projects/"], generatedPaths: [] };
    startScheduler({
      repo: resolve(c.projectsDir, ".."),
      hostname: machineHostname(),
      dataPaths: autoSync.dataPaths,
      generatedPaths: autoSync.generatedPaths,
      intervalMinutes: autoSync.intervalMinutes,
      notifyCmd: autoSync.notifyCmd,
    });
  }
}
