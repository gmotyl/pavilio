import { useEffect, useRef } from "react";

const memory = new Map<string, number>();

export function __resetForTests(): void {
  memory.clear();
}

function key(project: string | undefined, section: string | undefined): string {
  return `${project ?? ""}/${section ?? "overview"}`;
}

const SKIP_SECTIONS = new Set<string>(["iterm"]);

export function useTabScrollMemory(
  project: string | undefined,
  section: string | undefined,
  containerRef: React.RefObject<HTMLElement>,
): void {
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !project) return;

    const currentKey = key(project, section);

    // Save the previous section's scroll before switching
    if (lastKeyRef.current && lastKeyRef.current !== currentKey) {
      memory.set(lastKeyRef.current, el.scrollTop);
    }
    lastKeyRef.current = currentKey;

    // Restore for the new section (skip iterm — terminal manages its own scroll)
    const sec = section ?? "overview";
    if (!SKIP_SECTIONS.has(sec)) {
      const saved = memory.get(currentKey) ?? 0;
      requestAnimationFrame(() => {
        el.scrollTop = saved;
      });
    }

    // Throttled scroll listener: store latest scrollTop while user reads
    let pending: number | null = null;
    const onScroll = () => {
      if (pending !== null) return;
      pending = window.setTimeout(() => {
        pending = null;
        if (lastKeyRef.current) {
          memory.set(lastKeyRef.current, el.scrollTop);
        }
      }, 100);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (pending !== null) {
        window.clearTimeout(pending);
      }
      // Save final position on unmount/section change
      if (lastKeyRef.current) {
        memory.set(lastKeyRef.current, el.scrollTop);
      }
    };
  }, [project, section, containerRef]);
}
