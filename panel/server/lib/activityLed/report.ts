export interface ActivityLedSettings {
  enabled: boolean;
  host: string;
  port: number;
  colourAttention: string; // "#RRGGBB"
  colourBusy: string; // "#RRGGBB"
  brightness: number;
  blinkMs: number;
  pauseMs: number;
}

export const ACTIVITY_LED_DEFAULTS: ActivityLedSettings = {
  enabled: false,
  host: "192.168.10.156",
  port: 4210,
  colourAttention: "#00FF00",
  colourBusy: "#FF0000",
  brightness: 20,
  blinkMs: 150,
  pauseMs: 2000,
};

const REPORT_LENGTH = 34;
const SOURCE_LENGTH = 16;
const COLOUR_RE = /^#[0-9a-fA-F]{6}$/;

const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(n)));

const num = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === "number" && Number.isFinite(v) ? clamp(v, min, max) : fallback;

const colour = (v: unknown, fallback: string): string =>
  typeof v === "string" && COLOUR_RE.test(v) ? v : fallback;

export function normaliseSettings(raw: unknown): ActivityLedSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = ACTIVITY_LED_DEFAULTS;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    host: typeof r.host === "string" && r.host.trim() !== "" ? r.host.trim() : d.host,
    port: num(r.port, d.port, 1, 65535),
    colourAttention: colour(r.colourAttention, d.colourAttention),
    colourBusy: colour(r.colourBusy, d.colourBusy),
    brightness: num(r.brightness, d.brightness, 0, 100),
    blinkMs: num(r.blinkMs, d.blinkMs, 50, 1000),
    pauseMs: num(r.pauseMs, d.pauseMs, 500, 10000),
  };
}

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};

/** Activity report v1: 34 bytes, multi-byte fields big-endian. */
export function encodeReport(
  settings: ActivityLedSettings,
  counts: { attention: number; busy: number },
  machineId: string,
): Buffer {
  const s = normaliseSettings(settings);
  const buf = Buffer.alloc(REPORT_LENGTH); // zero-filled → source is NUL-padded
  buf.write("PVLD", 0, "ascii");
  buf[4] = 1;
  Buffer.from(machineId, "utf8").copy(buf, 5, 0, SOURCE_LENGTH);
  buf[21] = num(counts.attention, 0, 0, 255);
  buf[22] = num(counts.busy, 0, 0, 255);
  buf.set(rgb(s.colourAttention), 23);
  buf.set(rgb(s.colourBusy), 26);
  buf[29] = s.brightness;
  buf.writeUInt16BE(s.blinkMs, 30);
  buf.writeUInt16BE(s.pauseMs, 32);
  return buf;
}
