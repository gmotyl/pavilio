import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { appendTimeEntry, readTimeEntries, TimeEntry } from "../lib/time-store.js";

const ALLOWED_TYPES = new Set(["manual", "busy_block", "reset"]);

export function mountTimeRoutes(
  app: Express,
  opts: { projectsDir: string; hostname: string },
) {
  app.post("/api/time/append", (req: Request, res: Response) => {
    const { project, entry } = req.body ?? {};
    if (!project || typeof project !== "string" || !entry || typeof entry !== "object")
      return res.status(400).json({ error: "project and entry are required" });
    if (!ALLOWED_TYPES.has(entry.type))
      return res.status(400).json({ error: "invalid entry.type" });

    const stored: TimeEntry = { ...entry, id: entry.id ?? randomBytes(8).toString("hex") };
    appendTimeEntry({
      projectsDir: opts.projectsDir,
      projectName: project,
      hostname: opts.hostname,
      entry: stored,
    });
    res.json({ entry: stored });
  });

  app.get("/api/time/range", (req: Request, res: Response) => {
    const project = String(req.query.project ?? "");
    const from = String(req.query.from ?? "");
    const to = String(req.query.to ?? "");
    if (!project || !from || !to)
      return res.status(400).json({ error: "project, from, to required" });
    const all = readTimeEntries({ projectsDir: opts.projectsDir, projectName: project });
    const manual = all.filter(
      (e): e is Extract<TimeEntry, { type: "manual" }> =>
        e.type === "manual" && e.date >= from && e.date <= to,
    );
    const entries = manual.map((m) => ({ date: m.date, minutes: m.minutes, note: m.note }));
    res.json({ entries });
  });

  app.get("/api/time/today", (req: Request, res: Response) => {
    const project = String(req.query.project ?? "");
    if (!project) return res.status(400).json({ error: "project is required" });
    const today = new Date().toISOString().slice(0, 10);
    const all = readTimeEntries({ projectsDir: opts.projectsDir, projectName: project });
    const todayEntries = all.filter((e) => e.date === today);
    const lastResetTs = todayEntries
      .filter((e): e is Extract<TimeEntry, { type: "reset" }> => e.type === "reset")
      .map((e) => e.ts)
      .sort()
      .pop();
    const busyMinutes = todayEntries
      .filter((e): e is Extract<TimeEntry, { type: "busy_block" }> => e.type === "busy_block")
      .filter((e) => !lastResetTs || e.start > lastResetTs)
      .reduce((s, e) => s + e.minutes, 0);
    const manualMinutes = todayEntries
      .filter((e): e is Extract<TimeEntry, { type: "manual" }> => e.type === "manual")
      .reduce((s, e) => s + e.minutes, 0);
    res.json({ entries: todayEntries, totals: { busyMinutes, manualMinutes } });
  });
}
