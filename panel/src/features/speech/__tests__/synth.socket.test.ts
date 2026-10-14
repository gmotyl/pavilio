import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { speechCacheState, synthesizeSpeech } from "../synth";
import golden from "./fixtures/secMsGec.vectors.json";

/**
 * Drives `synthesizeSpeech` through the REAL (pnpm-patched)
 * `edge-tts-universal/browser` — no module mock — with only the WebSocket
 * stubbed. `synth.test.ts` fakes the whole library, so it cannot see what the
 * library does on the wire; these tests pin the two things the 2026-10 outage
 * broke: the token the URL carries, and that a refused handshake rejects
 * instead of hanging the cell red.
 */

type Script = (socket: FakeWebSocket) => void;

let script: Script = () => {};
const sockets: FakeWebSocket[] = [];

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(readonly url: string) {
    super();
    sockets.push(this);
    // Like a real socket, nothing happens until the constructing task yields.
    setTimeout(() => script(this), 0);
  }

  send(data: string): void {
    this.sent.push(data);
    // The second frame is the SSML request: answer it like the service does.
    if (this.sent.length === 2) setTimeout(() => this.respond?.(), 0);
  }

  respond?: () => void;

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.fire("close", new Event("close"));
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.fire("open", new Event("open"));
  }

  /** What a browser does when the HTTP upgrade is answered 403: error, then close. */
  refuseHandshake(): void {
    this.fire("error", new Event("error"));
    this.fire("close", new Event("close"));
  }

  message(data: string | ArrayBuffer): void {
    const event = new MessageEvent("message", { data });
    this.onmessage?.(event);
    this.dispatchEvent(event);
  }

  private fire(type: "open" | "error" | "close", event: Event): void {
    if (type === "close") this.readyState = FakeWebSocket.CLOSED;
    (this[`on${type}`] as ((e: Event) => void) | null)?.(event);
    this.dispatchEvent(event);
  }
}

function audioFrame(bytes: number[]): ArrayBuffer {
  const header = new TextEncoder().encode(
    "X-RequestId:x\r\nContent-Type:audio/mpeg\r\nPath:audio\r\n",
  );
  const frame = new Uint8Array(2 + header.length + bytes.length);
  frame[0] = header.length >> 8;
  frame[1] = header.length & 0xff;
  frame.set(header, 2);
  frame.set(bytes, 2 + header.length);
  return frame.buffer;
}

beforeEach(() => {
  sockets.length = 0;
  script = () => {};
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("synthesizeSpeech over the patched edge-tts-universal", () => {
  it("connects with the Sec-MS-GEC v2 token and version", async () => {
    const [vector] = golden.vectors.filter((v) => v.unixSeconds > 1_700_000_000);
    vi.spyOn(Date, "now").mockReturnValue(vector.unixSeconds * 1000);
    script = (socket) => socket.refuseHandshake();

    await synthesizeSpeech("token check", { voice: "en-GB-RyanNeural" }).catch(() => {});

    const url = new URL(sockets[0].url);
    expect(url.searchParams.get("Sec-MS-GEC")).toBe(vector.token);
    expect(url.searchParams.get("Sec-MS-GEC-Version")).toBe(golden.secMsGecVersion);
  });

  it("rejects promptly when the handshake is refused (HTTP 403), instead of hanging", async () => {
    script = (socket) => socket.refuseHandshake();
    const started = Date.now();

    const promise = synthesizeSpeech("refused handshake", { voice: "en-GB-RyanNeural" });
    expect(speechCacheState("refused handshake", { voice: "en-GB-RyanNeural" })).toBe("warming");

    await expect(promise).rejects.toThrow(/closed before it opened/);
    // Far inside the 15 s stall watchdog: the failure is the socket's, not a timeout's.
    expect(Date.now() - started).toBeLessThan(2000);
    // One connection, no stall retry, and the cell is no longer synthesizing.
    expect(sockets).toHaveLength(1);
    expect(speechCacheState("refused handshake", { voice: "en-GB-RyanNeural" })).toBe("cold");
  });

  it("rejects when the socket opens but closes before any audio", async () => {
    script = (socket) => {
      socket.respond = () => socket.close();
      socket.open();
    };

    await expect(
      synthesizeSpeech("closed before audio", { voice: "en-GB-RyanNeural" }),
    ).rejects.toThrow(/No audio was received/);
    expect(speechCacheState("closed before audio", { voice: "en-GB-RyanNeural" })).toBe("cold");
  });

  it("still assembles the audio of a healthy stream", async () => {
    script = (socket) => {
      socket.respond = () => {
        socket.message("X-RequestId:x\r\nPath:turn.start\r\n\r\n{}");
        socket.message(audioFrame([1, 2]));
        socket.message(audioFrame([3]));
        socket.message("X-RequestId:x\r\nPath:turn.end\r\n\r\n{}");
      };
      socket.open();
    };

    const buffer = await synthesizeSpeech("healthy stream", { voice: "en-GB-RyanNeural" });
    expect([...new Uint8Array(buffer)]).toEqual([1, 2, 3]);
  });
});
