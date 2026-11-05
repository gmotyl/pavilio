/**
 * The panel server's wait for the Kokoro server's first byte; shared with the browser, which
 * cannot import server code. Covers a cold model load on the first request.
 */
export const KOKORO_FIRST_BYTE_TIMEOUT_MS = 30000;
