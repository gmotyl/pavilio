import { useEffect, useRef } from "react";
import { preferences } from "../../preferences/declarations";
import { preferencesReadOnly, readPreference, writePreference } from "../../preferences/store";
import { alerts } from "./store";

export const PREFERENCES_READ_ONLY_ALERT_ID = "preferences-read-only";

/**
 * Says once, at boot, that this panel cannot save preferences: the file on
 * disk was written by a newer panel, so changes live only in memory until the
 * panel restarts. Renders nothing; the alert itself lives in `AlertHost`.
 *
 * Raised exactly once per mount, from a mount effect that reads the dismissal
 * imperatively instead of subscribing to it. Re-pushing the same id is not
 * harmless: during a swipe's slide-out it keeps the card mounted at opacity 0.
 * So neither a re-render nor an unrelated preference write may raise it again,
 * and the ref also absorbs StrictMode's double effect run.
 *
 * Dismissal goes to the session tier (`browserStore: "session"`), never to the
 * server — the server is precisely what cannot store it.
 */
export default function PreferencesReadOnlyAlert(): null {
  const raised = useRef(false);

  useEffect(() => {
    if (raised.current) return;
    raised.current = true;
    if (!preferencesReadOnly()) return;
    if (readPreference(preferences.readOnlyAlertDismissed)) return;
    alerts.warning("Preferences are read-only", {
      detail:
        "The preferences file was written by a newer panel. Changes last until the panel restarts.",
      persistent: true,
      id: PREFERENCES_READ_ONLY_ALERT_ID,
      onDismiss: () => writePreference(preferences.readOnlyAlertDismissed, true),
    });
  }, []);

  return null;
}
