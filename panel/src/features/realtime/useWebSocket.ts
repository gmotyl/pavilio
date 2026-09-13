import { useEffect, useState } from "react";
import { type RealtimeFrame, subscribeRealtime } from "./channel";

/**
 * Reads the tab's realtime channel. `lastMessage` starts null and only ever
 * holds frames that arrived while this component was mounted — the channel
 * replays nothing, so a remount never re-announces an old frame.
 *
 * Each frame is a fresh object (the channel parses or copies every one), so
 * two identical frames still change identity and consumers' effects re-run.
 */
export function useWebSocket() {
  const [lastMessage, setLastMessage] = useState<RealtimeFrame | null>(null);

  useEffect(() => subscribeRealtime(setLastMessage), []);

  return { lastMessage };
}
