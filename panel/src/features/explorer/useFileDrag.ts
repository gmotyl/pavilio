import { useState, type DragEvent } from "react";
import { toast } from "../../lib/toast";

const PAVILIO_FILE_MIME = "application/x-pavilio-file";

export interface MoveResponse {
  from: string;
  to: string;
  renamed: boolean;
  noop?: boolean;
  error?: string;
}

/** Source: any row representing a file under projectsDir. */
export function useFileDragSource(relativePath: string) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      e.dataTransfer.setData(PAVILIO_FILE_MIME, relativePath);
      e.dataTransfer.setData("text/plain", relativePath);
      e.dataTransfer.effectAllowed = "move";
    },
  };
}

/**
 * Target: a folder/section/project-header row. `targetDir` is a relativePath
 * under projectsDir (e.g. "alokai" or "alokai/notes").
 * `onMoved` receives the parsed response (or `{ error }` shape on failure).
 */
export function useFileDropTarget(
  targetDir: string,
  onMoved?: (res: MoveResponse) => void,
) {
  const [hover, setHover] = useState(false);

  const accepts = (e: DragEvent<HTMLElement>) =>
    Array.from(e.dataTransfer.types).includes(PAVILIO_FILE_MIME);

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
        const from = e.dataTransfer.getData(PAVILIO_FILE_MIME);
        if (!from) return;
        try {
          const res = await fetch("/api/files/move", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ from, to: targetDir }),
          });
          const body: MoveResponse = await res.json();
          if (!res.ok) {
            toast.error(`Move failed: ${body.error ?? "unknown error"}`);
            onMoved?.({ ...body, error: body.error ?? "unknown error" } as MoveResponse);
            return;
          }
          const filename = from.split("/").pop() ?? from;
          if (body.noop) {
            toast.info(`${filename} is already in ${targetDir}/`);
          } else if (body.renamed) {
            const finalName = body.to.split("/").pop();
            toast.success(`Moved ${filename} → ${targetDir}/${finalName} (renamed — collision)`);
          } else {
            toast.success(`Moved ${filename} → ${targetDir}/`);
          }
          onMoved?.(body);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          toast.error(`Move failed: ${msg}`);
        }
      },
    },
  };
}

export const PAVILIO_FILE_MIME_TYPE = PAVILIO_FILE_MIME;
