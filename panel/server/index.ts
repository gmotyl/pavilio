import express from "express";
import { createServer as createHttpServer } from "http";
import { createServer as createHttpsServer } from "https";
import { readFileSync } from "fs";
import { createServer as createViteServer } from "vite";
import { loadConfig, getConfig } from "./config.js";
import {
  authMiddleware,
  loginHandler,
  logoutHandler,
  statusHandler,
} from "./lib/auth.js";
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

async function start() {
  await loadConfig();
  rebuildIndex();
  const { port, tlsCert, tlsKey } = getConfig();

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

  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });

  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/auth/login", loginHandler);
  app.post("/api/auth/logout", logoutHandler);
  app.get("/api/auth/status", statusHandler);
  app.use(authMiddleware);

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
