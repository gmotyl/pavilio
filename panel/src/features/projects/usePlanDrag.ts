import { useState, type DragEvent } from "react";
import { toast } from "../../lib/toast";

/** Distinct from the notes-world file MIME so notes drop targets won't accept plan drags. */
const PAVILIO_PLAN_MIME = "application/x-pavilio-plan";

export interface PlanMoveResponse {
  from: string;
  to: string;
  renamed: boolean;
  noop?: boolean;
  error?: string;
}

/** Source: a plan file row. `absolutePath` is the on-disk path (may be outside projectsDir). */
export function usePlanDragSource(absolutePath: string) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      e.dataTransfer.setData(PAVILIO_PLAN_MIME, absolutePath);
      e.dataTransfer.setData("text/plain", absolutePath);
      e.dataTransfer.effectAllowed = "move";
    },
  };
}

/**
 * Target: a plan source node (project / workspace / repo / claude). `toId` is the
 * source id; the server resolves it to a destination plans directory.
 */
export function usePlanDropTarget(
  projectName: string,
  toId: string,
  onMoved?: (res: PlanMoveResponse) => void,
) {
  const [hover, setHover] = useState(false);

  const accepts = (e: DragEvent<HTMLElement>) =>
    Array.from(e.dataTransfer.types).includes(PAVILIO_PLAN_MIME);

  return {
    hover,
    dropHandlers: {
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!hover) setHover(true);
      },
      onDragEnter: (e: DragEvent<HTMLElement>) => {
        if (!accepts(e)) return;
        e.preventDefault();
        setHover(true);
      },
      onDragLeave: () => setHover(false),
      onDrop: async (e: DragEvent<HTMLElement>) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setHover(false);
        const from = e.dataTransfer.getData(PAVILIO_PLAN_MIME);
        if (!from) return;
        const filename = from.split("/").pop() ?? from;
        try {
          const res = await fetch(`/api/projects/${projectName}/plans/move`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ from, toId }),
          });
          const body: PlanMoveResponse = await res.json();
          if (!res.ok) {
            toast.error(`Move failed: ${body.error ?? "unknown error"}`);
            return;
          }
          if (body.noop) {
            toast.info(`${filename} is already here`);
          } else if (body.renamed) {
            toast.success(`Moved ${filename} (renamed — collision)`);
          } else {
            toast.success(`Moved ${filename}`);
          }
          onMoved?.(body);
        } catch (err) {
          toast.error(`Move failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    },
  };
}
