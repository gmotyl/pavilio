import type { Server } from "http";
import type { WebSocketServer } from "ws";

type BindHost = "127.0.0.1" | "0.0.0.0";

let panelServer: Server | null = null;
let panelPort: number | null = null;
let currentHost: BindHost = "127.0.0.1";
let rebindLock: Promise<void> = Promise.resolve();
let getWssRef: (() => WebSocketServer | null) | null = null;

export function registerPanelServer(
  server: Server,
  port: number,
  getWss: () => WebSocketServer | null,
): void {
  panelServer = server;
  panelPort = port;
  getWssRef = getWss;
}

export function getCurrentBindHost(): BindHost {
  return currentHost;
}

export function resetPanelListenerForTests(): void {
  panelServer = null;
  panelPort = null;
  currentHost = "127.0.0.1";
  rebindLock = Promise.resolve();
  getWssRef = null;
}

export async function rebindPanel(host: BindHost): Promise<void> {
  const run = rebindLock.then(() => rebindInner(host));
  rebindLock = run.catch(() => {});
  return run;
}

async function rebindInner(host: BindHost): Promise<void> {
  if (!panelServer || panelPort === null) {
    throw new Error("panel-listener: registerPanelServer was not called");
  }
  if (host === currentHost) return;

  const server = panelServer;
  const port = panelPort;

  // Tear down upgraded WebSockets so server.close() doesn't hang on them.
  const wss = getWssRef?.();
  if (wss) {
    for (const client of wss.clients) {
      try {
        client.terminate();
      } catch {
        // best-effort; ignore
      }
    }
  }

  // Force-drop any keep-alive HTTP connections.
  const anyServer = server as unknown as {
    closeAllConnections?: () => void;
    closeIdleConnections?: () => void;
  };
  anyServer.closeAllConnections?.();
  anyServer.closeIdleConnections?.();

  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });

  try {
    await listenOn(server, port, host);
    currentHost = host;
  } catch (err) {
    // Listen failed on target host — attempt to restore loopback so the
    // panel isn't left bindless. If fallback also fails, rethrow the
    // original error so the caller can surface a fatal state.
    try {
      await listenOn(server, port, "127.0.0.1");
      currentHost = "127.0.0.1";
    } catch {
      throw err;
    }
    throw wrapRebindError(err, host);
  }
}

function listenOn(server: Server, port: number, host: BindHost): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      server.removeListener("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function wrapRebindError(err: unknown, host: BindHost): Error {
  const code = (err as NodeJS.ErrnoException | null)?.code ?? "UNKNOWN";
  const base = `Rebind to ${host} failed: ${code}`;
  if (code === "EADDRINUSE" && host === "0.0.0.0") {
    return new Error(`${base} (another process holds 0.0.0.0:<port>)`);
  }
  if (code === "EACCES") {
    return new Error(`${base} (OS denied bind permission)`);
  }
  return new Error(base);
}
