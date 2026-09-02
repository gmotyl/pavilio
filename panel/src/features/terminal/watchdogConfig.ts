// Leaf module: it imports nothing, so `terminalInstances` and
// `useMobileReconnect` can both read the threshold without importing each other.

/** Silence after which the mobile watchdog considers the socket stale. */
export const WATCHDOG_STALE_MS = 25_000;
