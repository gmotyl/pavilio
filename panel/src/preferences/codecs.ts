import type { PreferenceCodec } from "./types";

export const bool: PreferenceCodec<boolean> = {
  parse(raw) {
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new Error(`not a boolean: ${raw}`);
  },
  serialize(value) {
    return String(value);
  },
};

export const num: PreferenceCodec<number> = {
  parse(raw) {
    const value = Number(raw);
    // `Number("")` is 0, which would turn a blank stored value into a
    // plausible-looking width rather than a fall back to the default.
    if (raw.trim() === "" || !Number.isFinite(value)) throw new Error(`not a number: ${raw}`);
    return value;
  },
  serialize(value) {
    return String(value);
  },
};

export const str: PreferenceCodec<string> = {
  parse(raw) {
    return raw;
  },
  serialize(value) {
    return value;
  },
};

/** A function, not a constant: each declaration gets its own instance typed to its own payload. */
export function json<T>(): PreferenceCodec<T> {
  return {
    parse(raw) {
      return JSON.parse(raw) as T;
    },
    serialize(value) {
      return JSON.stringify(value);
    },
  };
}
