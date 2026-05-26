import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import {
  appendTimeEntry,
  patchTimeEntry,
  readTimeEntries,
  TimeEntry,
} from "../lib/time-store.js";
import { validateProjectName } from "../lib/projectName.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isPositiveInteger = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0;

const ALLOWED_TYPES = new Set(["manual", "busy_block", "reset"]);
const MAX_MINUTES = 24 * 60;
const isValidMinutes = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && n < MAX_MINUTES;

export function mountTimeRoutes(
  app: Express,
  opts: { projectsDir: string; hostname: string },
) {
  app.post("/api/time/append", (req: Request, res: Response) => {
    const { project, entry } = req.body ?? {};
    const projectErr = validateProjectName(project);
    if (projectErr) return res.status(400).json({ error: projectErr });
    if (!entry || typeof entry !== "object")
      return res.status(400).json({ error: "entry is required" });
    if (!ALLOWED_TYPES.has(entry.type))
      return res.status(400).json({ error: "invalid entry.type" });
    if ((entry.type === "manual" || entry.type === "busy_block") && !isValidMinutes(entry.minutes))
      return res.status(400).json({ error: "minutes must be a finite number in [0, 1440)" });

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
    const projectErr = validateProjectName(project);
    if (projectErr) return res.status(400).json({ error: projectErr });
    if (!from || !to)
      return res.status(400).json({ error: "from, to required" });
    const all = readTimeEntries({ projectsDir: opts.projectsDir, projectName: project });
    const manual = all.filter(
      (e): e is Extract<TimeEntry, { type: "manual" }> =>
        e.type === "manual" && e.date >= from && e.date <= to,
    );
    const entries = manual.map((m) => ({ date: m.date, minutes: m.minutes, note: m.note }));
    res.json({ entries });
  });

  app.patch("/api/time/entry/:id", (req: Request, res: Response) => {
    const id = req.params.id;
    const { project, patch } = req.body ?? {};
    const projectErr = validateProjectName(project);
    if (projectErr) return res.status(400).json({ error: projectErr });
    if (!patch || typeof patch !== "object")
      return res.status(400).json({ error: "patch is required" });
    if ("minutes" in patch && !isPositiveInteger(patch.minutes))
      return res.status(400).json({ error: "minutes must be a non-negative integer" });
    if ("date" in patch && (typeof patch.date !== "string" || !ISO_DATE.test(patch.date)))
      return res.status(400).json({ error: "date must be YYYY-MM-DD" });
    if ("note" in patch && typeof patch.note !== "string")
      return res.status(400).json({ error: "note must be a string" });
    const ok = patchTimeEntry({
      projectsDir: opts.projectsDir,
      projectName: project,
      hostname: opts.hostname,
      entryId: id,
      patch,
    });
    if (!ok) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  });

  app.delete("/api/time/entry/:id", (req: Request, res: Response) => {
    const id = req.params.id;
    const project = String(req.query.project ?? "");
    const projectErr = validateProjectName(project);
    if (projectErr) return res.status(400).json({ error: projectErr });
    const ok = patchTimeEntry({
      projectsDir: opts.projectsDir,
      projectName: project,
      hostname: opts.hostname,
      entryId: id,
      patch: null,
    });
    if (!ok) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  });

  app.get("/api/time/today", (req: Request, res: Response) => {
    const project = String(req.query.project ?? "");
    const projectErr = validateProjectName(project);
    if (projectErr) return res.status(400).json({ error: projectErr });
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
