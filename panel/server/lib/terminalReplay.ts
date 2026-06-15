// These packages ship as CJS whose named exports a native-ESM loader (tsx,
// running the server) cannot statically detect — `import { Terminal }` resolves
// to undefined at runtime even though the types declare it. Import the default
// (the CJS module.exports object) and destructure. esModuleInterop makes this
// type-safe; it also works under Vitest's bundler interop.
import headlessPkg from "@xterm/headless";
import serializePkg from "@xterm/addon-serialize";

const { Terminal } = headlessPkg;
const { SerializeAddon } = serializePkg;

// One headless terminal per PTY session, fed every output chunk so that a
// client attaching later can be sent a serialized snapshot of the screen +
// scrollback. This is the server-side source of truth for "what's on screen"
// — see docs/adr/0004-headless-xterm-replay-on-reconnect.md.

// Match the client's scrollback (terminalInstances.ts: scrollback: 5000) so a
// reconnecting client gets the same history it would have had locally.
const SCROLLBACK = 5000;

interface ReplayBuffer {
  term: Terminal;
  serialize: SerializeAddon;
}

const buffers = new Map<string, ReplayBuffer>();

export function createReplay(id: string, cols: number, rows: number): void {
  if (buffers.has(id)) return; // idempotent
  const term = new Terminal({
    cols: Math.max(1, cols),
    rows: Math.max(1, rows),
    scrollback: SCROLLBACK,
    allowProposedApi: true,
  });
  const serialize = new SerializeAddon();
  term.loadAddon(serialize);
  buffers.set(id, { term, serialize });
}

export function feedReplay(id: string, data: string): void {
  buffers.get(id)?.term.write(data);
}

// Resolve once the headless terminal's write queue has drained, so a
// subsequent serialize() reflects everything fed so far. Relies on xterm's
// documented guarantee that write callbacks are invoked in write-call order,
// so write("", cb) fires only after all prior writes have been parsed.
export function flushReplay(id: string): Promise<void> {
  const buf = buffers.get(id);
  if (!buf) return Promise.resolve();
  return new Promise((resolve) => buf.term.write("", () => resolve()));
}

export function resizeReplay(id: string, cols: number, rows: number): void {
  const buf = buffers.get(id);
  if (!buf) return;
  try {
    buf.term.resize(Math.max(1, cols), Math.max(1, rows));
  } catch (err) {
    console.warn(`[terminalReplay:${id}] resize failed:`, err);
  }
}

export function serializeReplay(id: string): string {
  const buf = buffers.get(id);
  if (!buf) return "";
  try {
    return buf.serialize.serialize();
  } catch (err) {
    console.warn(`[terminalReplay:${id}] serialize failed:`, err);
    return "";
  }
}

export function destroyReplay(id: string): void {
  const buf = buffers.get(id);
  if (!buf) return;
  try {
    buf.term.dispose();
  } catch (err) {
    console.warn(`[terminalReplay:${id}] dispose failed:`, err);
  }
  buffers.delete(id);
}

export function _resetReplayForTests(): void {
  for (const id of [...buffers.keys()]) destroyReplay(id);
}

// Full reset first (clears modes + screen so a non-empty client doesn't
// double-paint), then restore modes (preamble), then paint the snapshot.
const RESET = "\x1bc";
export function buildReplayPayload(preamble: string, snapshot: string): string {
  return RESET + (preamble ?? "") + (snapshot ?? "");
}
