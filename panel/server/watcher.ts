import chokidar from "chokidar";
import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import { getConfig } from "./config.js";
import { rebuildIndex } from "./lib/file-index.js";
import { getSession, resizeSession } from "./lib/terminal-manager.js";
import { recordInput, dismiss, getSnapshot, subscribe, type ActivityEvent } from "./lib/terminalActivity.js";
import { validateWsToken } from "./lib/auth.js";

let wss: WebSocketServer;

export function setupWebSocket(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server });

  wss.on("connection", (ws, req) => {
    if (!validateWsToken(req.headers.cookie)) {
      ws.close(4001, "Unauthorized");
      return;
    }

    const url = req.url || "";
    const termMatch = url.match(/^\/ws\/terminal\/(.+)$/);

    if (termMatch) {
      attachTerminalSocket(ws, termMatch[1]);
      return;
    }

    if (url === "/ws/terminal-activity") {
      // Send snapshot of all current session states
      for (const ev of getSnapshot()) {
        ws.send(JSON.stringify({ type: "state", ...ev }));
      }
      // Subscribe to future state changes
      const unsub = subscribe((ev: ActivityEvent) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "state", ...ev }));
        }
      });
      ws.on("close", () => unsub());
      return;
    }

    // Broadcast subscription connection (file-change, agent-change)
    ws.send(JSON.stringify({ type: "connected" }));
  });

  return wss;
}

function attachTerminalSocket(ws: WebSocket, sessionId: string): void {
  const session = getSession(sessionId);
  if (!session) {
    ws.close(4004, "Session not found");
    return;
  }

  const dataSub = session.pty.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "output", data }));
    }
  });

  const exitSub = session.pty.onExit(({ exitCode }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "exit", code: exitCode }));
      ws.close();
    }
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "input" && typeof msg.data === "string") {
        recordInput(sessionId);
        session.pty.write(msg.data);
      } else if (msg.type === "dismiss-attention") {
        dismiss(sessionId);
        return;
      } else if (msg.type === "resize") {
        resizeSession(sessionId, Number(msg.cols), Number(msg.rows));
      }
    } catch {
      // ignore malformed payloads
    }
  });

  ws.on("close", () => {
    dataSub.dispose();
    exitSub.dispose();
  });
}

export function broadcast(data: Record<string, unknown>): void {
  if (!wss) return;
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

export function setupFileWatcher(): void {
  const { projectsDir, watchDebounceMs, ignorePatterns, agentRegistryPath } = getConfig();

  const watcher = chokidar.watch(projectsDir, {
    ignored: ignorePatterns,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: watchDebounceMs },
  });

  watcher.on("all", (event, path) => {
    rebuildIndex();
    broadcast({ type: "file-change", event, path });
  });

  console.log(`File watcher started on ${projectsDir}`);

  chokidar.watch(agentRegistryPath, { ignoreInitial: true }).on("all", () => {
    broadcast({ type: "agent-change" });
  });
}
