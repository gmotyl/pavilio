import express from "express";
import { createServer as createHttpServer } from "http";
import { createServer as createHttpsServer } from "https";
import { createServer as createNetServer } from "net";
import { readFileSync } from "fs";
import { createServer as createViteServer } from "vite";
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
import commandsRouter from "./routes/commands.js";
import agentSettingsRouter from "./routes/agent-settings.js";
import terminalRouter from "./routes/terminal.js";
import { setupWebSocket, setupFileWatcher } from "./watcher.js";
import { pruneDeadAgents } from "./lib/agent-registry.js";

async function findFreePort(start: number, span = 50): Promise<number> {
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

async function start() {
  await loadConfig();
  await loadAuthState();
  rebuildIndex();
  const { port: configuredPort, tlsCert, tlsKey } = getConfig();
  const port = await findFreePort(configuredPort);
  if (port !== configuredPort) {
    console.log(`Port ${configuredPort} in use, using ${port} instead.`);
  }

  const app = express();

  let server;
  if (tlsCert && tlsKey) {
    server = createHttpsServer(
      { cert: readFileSync(tlsCert), key: readFileSync(tlsKey) },
      app
    );
  } else {
    server = createHttpServer(app);
  }

  const hmrPort = await findFreePort(24678);
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: { port: hmrPort } },
    appType: "spa",
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
  app.use("/api/commands", commandsRouter);
  app.use("/api/agent-settings", agentSettingsRouter);
  app.use("/api/terminal", terminalRouter);

  app.use(vite.middlewares);

  const protocol = tlsCert && tlsKey ? "https" : "http";
  server.listen(port, "127.0.0.1", () => {
    console.log(`Panel bound to ${protocol}://127.0.0.1:${port} (loopback only)`);
  });

  setupWebSocket(server);
  setupFileWatcher();

  setInterval(pruneDeadAgents, 30_000);
}

start();
