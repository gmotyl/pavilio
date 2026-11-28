import { describe, it, expect } from "vitest";
import {
  ACTIVITY_LED_DEFAULTS,
  encodeReport,
  normaliseSettings,
  type ActivityLedSettings,
} from "../report";

const base: ActivityLedSettings = { ...ACTIVITY_LED_DEFAULTS, enabled: true };

describe("activity report v1", () => {
  it("encodes the v1 byte layout exactly", () => {
    const buf = encodeReport(base, { attention: 2, busy: 1 }, "spock");
    const expected = Buffer.from([
      0x50, 0x56, 0x4c, 0x44, 1,
      0x73, 0x70, 0x6f, 0x63, 0x6b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      2, 1,
      0x00, 0xff, 0x00,
      0xff, 0x00, 0x00,
      20,
      0x00, 0x96,
      0x07, 0xd0,
    ]);
    expect(buf.length).toBe(34);
    expect(buf).toEqual(expected);
  });

  it("clamps brightness, blinkMs and pauseMs", () => {
    const buf = encodeReport(
      { ...base, brightness: 150, blinkMs: 10, pauseMs: 99999 },
      { attention: 0, busy: 0 },
      "spock",
    );
    expect(buf[29]).toBe(100);
    expect(buf.readUInt16BE(30)).toBe(50);
    expect(buf.readUInt16BE(32)).toBe(10000);
  });

  it("clamps counts to 255", () => {
    const buf = encodeReport(base, { attention: 300, busy: 1000 }, "spock");
    expect(buf[21]).toBe(255);
    expect(buf[22]).toBe(255);
  });

  it("truncates and pads the source id", () => {
    const long = encodeReport(base, { attention: 0, busy: 0 }, "abcdefghijklmnopqrstuvwxyz");
    expect(long.length).toBe(34);
    expect(long.subarray(5, 21).toString("utf8")).toBe("abcdefghijklmnop");
    const short = encodeReport(base, { attention: 0, busy: 0 }, "ab");
    expect([...short.subarray(5, 21)]).toEqual([0x61, 0x62, ...new Array(14).fill(0)]);
  });

  it("normaliseSettings falls back to defaults per field", () => {
    expect(normaliseSettings(undefined)).toEqual(ACTIVITY_LED_DEFAULTS);
    expect(normaliseSettings({ colourBusy: "red", colourAttention: "#0000ff", brightness: 50 })).toEqual({
      ...ACTIVITY_LED_DEFAULTS,
      colourAttention: "#0000ff",
      brightness: 50,
    });
    expect(normaliseSettings({ enabled: true, host: "", port: 70000, blinkMs: "x", pauseMs: 1 })).toEqual({
      ...ACTIVITY_LED_DEFAULTS,
      enabled: true,
      port: 65535,
      pauseMs: 500,
    });
  });
});
