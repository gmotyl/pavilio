import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { alerts } from "../alerts/store";
import {
  MOCKUP_MAX_BYTES,
  importedExt,
  isHtmlMockup,
  isMockupFile,
  isRasterImage,
  normaliseMockupSlug,
} from "./mockupFiles";

/** One picked or dropped file as the dialog shows it. */
export interface MockupImportRow {
  file: File;
  /** The extension the server will write (`.jpeg` → `.jpg`). */
  ext: string;
  /** Editable; pre-filled from the basename. */
  slug: string;
  /** Why the file will not be sent, or null when it will. */
  rejected: string | null;
  /** HTML is never previewed — untrusted markup gets a glyph, not a frame. */
  isHtml: boolean;
  /** From `/inspect`; 0 until it answers (and for raster files). */
  externalCount: number;
  /** Object URL for an image thumbnail; null for HTML and rejected rows. */
  thumbUrl: string | null;
}

interface ImportResult {
  name: string;
  relativePath: string;
  ok: boolean;
  error?: string;
}

const UNSUPPORTED = "Unsupported file type — SVG, PNG, JPEG, WebP or HTML only";
const TOO_LARGE = "Larger than 20 MB";

function rejection(file: File): string | null {
  if (!isMockupFile(file.name)) return UNSUPPORTED;
  if (file.size > MOCKUP_MAX_BYTES) return TOO_LARGE;
  return null;
}

function basename(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** `YYYY-MM-DD-` in local time — the prefix the server puts on every import. */
export function todayPrefix(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-`;
}

const canPreview = () => typeof URL.createObjectURL === "function";

/**
 * Drives one import batch: classifies the files, asks `/inspect` about
 * external references in HTML/SVG, and posts the accepted ones. Object URLs
 * made for thumbnails are revoked when the batch (the dialog) goes away.
 */
export function useMockupImport({
  project,
  files,
  onImported,
}: {
  project: string;
  files: File[];
  /** Relative paths of the files that landed, in the order they were sent. */
  onImported: (relativePaths: string[]) => void;
}) {
  const base = useMemo(
    () =>
      files.map((file) => ({
        file,
        ext: importedExt(file.name),
        rejected: rejection(file),
        isHtml: isHtmlMockup(file.name),
      })),
    [files],
  );
  const [slugs, setSlugs] = useState<string[]>(() =>
    files.map((f) => normaliseMockupSlug(basename(f.name))),
  );
  const [externalCounts, setExternalCounts] = useState<number[]>([]);
  const [thumbs, setThumbs] = useState<(string | null)[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Thumbnails: made in an effect (not during render) so the cleanup that
  // revokes them pairs with exactly the URLs it created.
  useEffect(() => {
    if (!canPreview()) return;
    const urls = base.map((r) =>
      r.rejected || r.isHtml ? null : URL.createObjectURL(r.file),
    );
    setThumbs(urls);
    return () => {
      for (const url of urls) if (url) URL.revokeObjectURL(url);
    };
  }, [base]);

  // Only HTML and SVG can reference external resources.
  useEffect(() => {
    const inspected = base
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => !r.rejected && !isRasterImage(r.file.name));
    if (inspected.length === 0) return;
    let cancelled = false;
    const body = new FormData();
    for (const { r } of inspected) body.append("files", r.file);
    fetch(`/api/projects/${encodeURIComponent(project)}/mockups/inspect`, {
      method: "POST",
      body,
    })
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { files?: { externalCount: number }[] };
        if (cancelled) return;
        const counts = base.map(() => 0);
        inspected.forEach(({ i }, k) => {
          counts[i] = data.files?.[k]?.externalCount ?? 0;
        });
        setExternalCounts(counts);
      })
      // The warning is advisory; a failed inspect just shows none.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [base, project]);

  const rows: MockupImportRow[] = base.map((r, i) => ({
    ...r,
    slug: slugs[i] ?? "",
    externalCount: externalCounts[i] ?? 0,
    thumbUrl: thumbs[i] ?? null,
  }));
  const acceptedCount = rows.filter((r) => !r.rejected).length;

  const setSlug = useCallback((index: number, slug: string) => {
    setSlugs((prev) => prev.map((s, i) => (i === index ? slug : s)));
  }, []);

  const submit = useCallback(async () => {
    const accepted = base
      .map((r, i) => ({ r, slug: slugs[i] ?? "" }))
      .filter(({ r }) => !r.rejected);
    if (accepted.length === 0) return;
    const body = new FormData();
    for (const { r, slug } of accepted) {
      body.append("files", r.file);
      body.append("slugs", slug);
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(project)}/mockups/import`,
        { method: "POST", body },
      );
      const data = (await res.json().catch(() => ({}))) as {
        files?: ImportResult[];
        error?: string;
      };
      if (!res.ok || !Array.isArray(data.files)) {
        alerts.error("Mockup import failed", { detail: data.error ?? `HTTP ${res.status}` });
        return;
      }
      const failed = data.files.filter((f) => !f.ok);
      if (failed.length > 0) {
        alerts.error(
          `${failed.length} of ${data.files.length} mockups were not imported`,
          { detail: failed.map((f) => `${f.name}: ${f.error ?? "failed"}`).join("; ") },
        );
      }
      onImported(data.files.filter((f) => f.ok).map((f) => f.relativePath));
    } catch (err) {
      alerts.error("Mockup import failed", { detail: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  }, [base, slugs, project, onImported]);

  return { rows, acceptedCount, setSlug, submit, submitting };
}

/** Whether a drag carries files from the OS (not a panel row being moved). */
const carriesFiles = (e: DragEvent) =>
  Array.from(e.dataTransfer?.types ?? []).includes("Files");

/**
 * Drop-target wiring for the Mockups list. Every dropped file goes to the
 * dialog — unsupported ones are listed there as rejected, never silently lost.
 */
export function useMockupDrop(onFiles: (files: File[]) => void) {
  const [dragging, setDragging] = useState(false);

  const dropProps = {
    onDragOver: (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      if (!dragging) setDragging(true);
    },
    onDragLeave: (e: DragEvent) => {
      const next = e.relatedTarget as Node | null;
      if (next && (e.currentTarget as Node).contains(next)) return;
      setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      setDragging(false);
      if (files.length === 0) return;
      e.preventDefault();
      onFiles(files);
    },
  };

  return { dragging, dropProps };
}
