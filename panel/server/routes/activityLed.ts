// POST /api/activity-led/test — send one test report (attention 1, busy 1)
// with the current settings, so Settings can check the board is reachable.

import { Router } from "express";
import { getActivityLed } from "../lib/activityLed/instance.js";

const activityLedRouter = Router();

activityLedRouter.post("/activity-led/test", (_req, res) => {
  getActivityLed()?.test();
  res.status(204).end();
});

export default activityLedRouter;
