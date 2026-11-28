// POST /api/activity-led/test — send one test report (attention 1, busy 1)
// with the current settings, so Settings can check the board is reachable.

import { Router } from "express";
import { getActivityLed } from "../lib/activityLed/instance.js";

const activityLedRouter = Router();

// 204 once the UDP send completes, 502 with the send error, 503 without a reporter.
activityLedRouter.post("/activity-led/test", async (_req, res) => {
  const led = getActivityLed();
  if (!led) {
    res.status(503).json({ error: "Activity LED reporter is not running" });
    return;
  }
  try {
    await led.test();
    res.status(204).end();
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default activityLedRouter;
