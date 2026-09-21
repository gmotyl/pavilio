import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAllTerminalSessions } from "../terminal/useAllTerminalSessions";
import { useProjectBusyTracker } from "./useProjectBusyTracker";

interface TimeTrackingContextValue {
  minutesByProject: Record<string, number>;
  resetProject: (project: string) => Promise<void>;
}

const TimeTrackingContext = createContext<TimeTrackingContextValue | null>(
  null,
);

// localStorage keys written by useBusyAccumulator look like
// `pavilio.time.<project>`. Two settings used to share that prefix —
// `pavilio.time.report.<project>` and
// `pavilio.time.form.<project>.resetAutoOnSave`. Both are preferences now and
// this panel writes neither, but the migration deliberately ORPHANS old raw
// keys rather than deleting them, so both still sit in every browser that ran
// an earlier build. The scan therefore stays defensive rather than being
// simplified away: an unskipped orphan is discovered as a phantom project, and
// the tracker slot that mounts for it stamps accumulator JSON over the key —
// which is how the real storage dump came to hold an accumulator object under
// a boolean flag. `form.` was never skipped, so that phantom is live today;
// this is where it stops.
const LS_PREFIX = "pavilio.time.";
const PREFERENCE_INFIXES = ["report.", "form."];

function scanStorageProjects(): string[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  // localStorage access can throw SecurityError when storage is disabled
  // (private mode, strict cookie policies). Degrade gracefully.
  try {
    const out: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || !k.startsWith(LS_PREFIX)) continue;
      const rest = k.slice(LS_PREFIX.length);
      if (PREFERENCE_INFIXES.some((infix) => rest.startsWith(infix))) continue;
      if (rest) out.push(rest);
    }
    return out;
  } catch (err) {
    console.warn("[time] localStorage scan failed", err);
    return [];
  }
}

interface SlotProps {
  project: string;
  onMinutes: (project: string, minutes: number | null) => void;
  onReset: (project: string, fn: (() => Promise<void>) | null) => void;
}

// One slot per tracked project. Each slot owns its own tracker hook so that
// minute counts and busy_block POSTs are produced exactly once per project,
// regardless of which route is currently rendered. On unmount the slot
// unregisters itself so the context map and resets registry don't accumulate
// stale entries when a project stops being tracked.
function ProjectTrackerSlot({ project, onMinutes, onReset }: SlotProps) {
  const { todayMinutes, resetToday } = useProjectBusyTracker(project);
  useEffect(() => {
    onMinutes(project, todayMinutes);
  }, [project, todayMinutes, onMinutes]);
  useEffect(() => {
    onReset(project, resetToday);
  }, [project, resetToday, onReset]);
  useEffect(() => {
    return () => {
      onMinutes(project, null);
      onReset(project, null);
    };
  }, [project, onMinutes, onReset]);
  return null;
}

export function TimeTrackingProvider({ children }: { children: ReactNode }) {
  const { sessions } = useAllTerminalSessions();
  const [minutesByProject, setMinutesByProject] = useState<
    Record<string, number>
  >({});
  const resetsRef = useRef<Map<string, () => Promise<void>>>(new Map());

  // Union of projects with live sessions and projects with persisted state.
  // The storage scan picks up projects whose terminals are closed today but
  // whose accumulator still has minutes from earlier in the day.
  const trackedProjects = useMemo(() => {
    const fromSessions = sessions
      .map((s) => s.project)
      .filter((p): p is string => Boolean(p));
    const fromStorage = scanStorageProjects();
    return Array.from(new Set([...fromSessions, ...fromStorage])).sort();
  }, [sessions]);

  const onMinutes = useCallback(
    (project: string, minutes: number | null) => {
      setMinutesByProject((m) => {
        if (minutes === null) {
          if (!(project in m)) return m;
          const next = { ...m };
          delete next[project];
          return next;
        }
        return m[project] === minutes ? m : { ...m, [project]: minutes };
      });
    },
    [],
  );

  const onReset = useCallback(
    (project: string, fn: (() => Promise<void>) | null) => {
      if (fn === null) {
        resetsRef.current.delete(project);
      } else {
        resetsRef.current.set(project, fn);
      }
    },
    [],
  );

  const resetProject = useCallback(async (project: string) => {
    const fn = resetsRef.current.get(project);
    if (fn) await fn();
  }, []);

  const value = useMemo<TimeTrackingContextValue>(
    () => ({ minutesByProject, resetProject }),
    [minutesByProject, resetProject],
  );

  return (
    <TimeTrackingContext.Provider value={value}>
      {trackedProjects.map((name) => (
        <ProjectTrackerSlot
          key={name}
          project={name}
          onMinutes={onMinutes}
          onReset={onReset}
        />
      ))}
      {children}
    </TimeTrackingContext.Provider>
  );
}

export function useProjectTodayMinutes(project: string): {
  todayMinutes: number;
  resetToday: () => Promise<void>;
} {
  const ctx = useContext(TimeTrackingContext);
  const resetProject = ctx?.resetProject;
  const resetToday = useCallback(
    (): Promise<void> =>
      resetProject && project ? resetProject(project) : Promise.resolve(),
    [resetProject, project],
  );
  const todayMinutes =
    ctx && project ? (ctx.minutesByProject[project] ?? 0) : 0;
  return { todayMinutes, resetToday };
}
