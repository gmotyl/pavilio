import { useState } from "react";

import {
  getNotificationsEnabled,
  notificationsAvailability,
  requestNotificationsPermission,
  setNotificationsEnabled,
  type NotificationsAvailability,
} from "./notificationsEnabled";

/**
 * The Settings-page checkbox for system notifications on this device. It pairs
 * the per-device switch with the browser permission behind it, so the box only
 * ever shows the state in effect: stored on AND permission granted. A switch
 * stored on whose permission was later revoked in the browser renders off.
 *
 * Switching on asks for permission from the click itself — browsers only
 * honour a prompt raised inside a user gesture — and the box settles on only
 * once the browser grants it. A refusal leaves it off and names where the user
 * can undo the block; an already-blocked browser is never prompted again.
 * Without the Notification API (an insecure origin, an old browser) the box is
 * disabled and says why.
 */
export function NotificationsToggle() {
  const [availability, setAvailability] = useState<NotificationsAvailability>(
    notificationsAvailability,
  );
  const [on, setOn] = useState<boolean>(
    () => getNotificationsEnabled() && notificationsAvailability() === "granted",
  );

  const unsupported = availability === "unsupported";

  const switchOn = () => {
    // Re-read: the user may have changed the permission in the browser since
    // this page rendered.
    const current = notificationsAvailability();
    setAvailability(current);
    if (current === "denied" || current === "unsupported") return;
    // Called synchronously inside the click handler, so the prompt keeps the
    // user gesture. No await may come before it.
    void requestNotificationsPermission().then((result) => {
      setAvailability(result);
      setOn(result === "granted" ? setNotificationsEnabled(true) : false);
    });
  };

  const switchOff = () => setOn(setNotificationsEnabled(false));

  return (
    <div>
      <label
        htmlFor="notifications-enabled"
        className={`inline-flex items-center gap-2 text-sm select-none ${
          unsupported ? "cursor-not-allowed opacity-60" : "cursor-pointer"
        }`}
        style={{ color: "var(--text-primary)" }}
      >
        <input
          id="notifications-enabled"
          data-testid="notifications-enabled"
          type="checkbox"
          checked={on}
          disabled={unsupported}
          aria-describedby="notifications-enabled-help"
          onChange={(e) => (e.target.checked ? switchOn() : switchOff())}
        />
        Notify me when a hidden session needs attention
      </label>
      <p
        id="notifications-enabled-help"
        className="text-xs mt-2"
        style={{ color: "var(--text-muted)" }}
      >
        {unsupported
          ? "This browser can't show notifications here — it needs a secure (https) origin or the installed app."
          : availability === "denied"
            ? "Notifications are blocked by your browser — allow them in the site or app settings."
            : "Applies to this device only; the browser asks for permission the first time."}
      </p>
    </div>
  );
}
