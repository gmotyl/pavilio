import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "http";
import { AddressInfo } from "net";
import {
  registerPanelServer,
  rebindPanel,
  getCurrentBindHost,
  resetPanelListenerForTests,
} from "../panel-listener";

let server: Server;
let port: number;

async function startServer(host: "127.0.0.1" | "0.0.0.0"): Promise<void> {
  server = createServer((_req, res) => {
    res.end("ok");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => resolve());
  });
  port = (server.address() as AddressInfo).port;
}

async function stopServer(): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

function addressOf(): string {
  return (server.address() as AddressInfo | null)?.address ?? "";
}

beforeEach(async () => {
  resetPanelListenerForTests();
  await startServer("127.0.0.1");
  registerPanelServer(server, port, () => null);
});

afterEach(async () => {
  await stopServer();
  resetPanelListenerForTests();
});

describe("rebindPanel", () => {
  it("flips bound address from 127.0.0.1 to 0.0.0.0 and back", async () => {
    expect(addressOf()).toBe("127.0.0.1");
    expect(getCurrentBindHost()).toBe("127.0.0.1");

    await rebindPanel("0.0.0.0");
    expect(addressOf()).toBe("0.0.0.0");
    expect(getCurrentBindHost()).toBe("0.0.0.0");

    await rebindPanel("127.0.0.1");
    expect(addressOf()).toBe("127.0.0.1");
    expect(getCurrentBindHost()).toBe("127.0.0.1");
  });

  it("is a no-op when the target host matches the current host", async () => {
    await rebindPanel("127.0.0.1");
    expect(addressOf()).toBe("127.0.0.1");
  });

  it("serializes concurrent rebind calls", async () => {
    const a = rebindPanel("0.0.0.0");
    const b = rebindPanel("127.0.0.1");
    const c = rebindPanel("0.0.0.0");
    await Promise.all([a, b, c]);
    // Final state should match the last-scheduled call.
    expect(getCurrentBindHost()).toBe("0.0.0.0");
    expect(addressOf()).toBe("0.0.0.0");
  });

  it("throws if called before registerPanelServer", async () => {
    resetPanelListenerForTests();
    await expect(rebindPanel("0.0.0.0")).rejects.toThrow(/registerPanelServer/);
  });
});
