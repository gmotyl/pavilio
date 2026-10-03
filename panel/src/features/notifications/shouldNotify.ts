/**
 * Whether an activity change should raise a system notification.
 *
 * Only the edge into "attention" counts: a session that republishes the same
 * state, or settles into busy/idle, has nothing new to say. A session seen for
 * the first time already in attention (`previous` undefined) counts as that
 * edge. The notification exists for when you are not looking, so a visible
 * panel stays silent, as does a switched-off preference or a permission the
 * browser has not granted.
 */
import type { ActivityState } from "../terminal/useTerminalActivityChannel";

export function shouldNotify(input: {
  previous: ActivityState | undefined;
  next: ActivityState;
  documentVisible: boolean;
  enabled: boolean;
  permission: NotificationPermission;
}): boolean {
  const { previous, next, documentVisible, enabled, permission } = input;
  return (
    next === "attention" &&
    previous !== "attention" &&
    !documentVisible &&
    enabled &&
    permission === "granted"
  );
}
