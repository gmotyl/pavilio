import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { alerts } from "../alerts/store";
import {
  MOCKUP_MAX_BYTES,
  MOCKUP_MAX_FILES,
  MOCKUP_MAX_TOTAL_BYTES,
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
const TOO_MANY = `At most ${MOCKUP_MAX_FILES} files per import`;
const OVER_TOTAL = "Over the 100 MB per-import total — import it separately";

function rejection(file: File): string | null {
  if (!isMockupFile(file.name)) return UNSUPPORTED;
  if (file.size > MOCKUP_MAX_BYTES) return TOO_LARGE;
  return null;
}

function basename(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * The server's local date (`YYYY-MM-DD`), which it prefixes every import
 * with; null when it cannot be had. The browser's own date is never a stand-in:
 * from another time zone it names a file that will not be saved.
 */
async function fetchServerDate(project: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(project)}/mockups/today`, {
      signal,
    });
    if (!res.ok) return null;
    const date = ((await res.json()) as { date?: unknown }).date;
    return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  } catch {
    return null;
  }
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
  const base = useMemo(() => {
    // Only files that would be sent count toward the limits, so an
    // unsupported file early in the batch does not push a good one out. The
    // byte budget is the server's per-request total: a file that would cross
    // it is not sent, and a later one that still fits is.
    let accepted = 0;
    let bytes = 0;
    return files.map((file) => {
      let rejected = rejection(file);
      if (!rejected && accepted >= MOCKUP_MAX_FILES) rejected = TOO_MANY;
      else if (!rejected && bytes + file.size > MOCKUP_MAX_TOTAL_BYTES) rejected = OVER_TOTAL;
      if (!rejected) {
        accepted++;
        bytes += file.size;
      }
      return {
        file,
        ext: importedExt(file.name),
        rejected,
        isHtml: isHtmlMockup(file.name),
      };
    });
  }, [files]);
  const [slugs, setSlugs] = useState<string[]>(() =>
    files.map((f) => normaliseMockupSlug(basename(f.name))),
  );
  const [externalCounts, setExternalCounts] = useState<number[]>([]);
  const [thumbs, setThumbs] = useState<(string | null)[]>([]);
  const [submitting, setSubmitting] = useState(false);
  // Synchronous twin of `submitting`: two clicks in one frame send one import.
  const submittingRef = useRef(false);
  const inspectAbort = useRef<AbortController | null>(null);
  // undefined while the first answer is pending, null if it never came.
  const [serverDate, setServerDate] = useState<string | null | undefined>(undefined);

  // The server prefixes imports with ITS local date. Import waits for it
  // (briefly); without it the dialog shows no date rather than a guessed one,
  // and the saved names still come back from the import itself.
  useEffect(() => {
    const controller = new AbortController();
    void fetchServerDate(project, controller.signal).then((date) => {
      if (!controller.signal.aborted) setServerDate(date);
    });
    return () => controller.abort();
  }, [project]);
  const datePending = serverDate === undefined;
  /** `YYYY-MM-DD-`, or null when the server's date is not known. */
  const prefix = serverDate ? `${serverDate}-` : null;

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
    // Aborted on close (and when the import starts), so a dismissed dialog
    // does not keep uploading, and the import is not a second parallel upload.
    const controller = new AbortController();
    inspectAbort.current = controller;
    const body = new FormData();
    for (const { r } of inspected) body.append("files", r.file);
    fetch(`/api/projects/${encodeURIComponent(project)}/mockups/inspect`, {
      method: "POST",
      body,
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok || controller.signal.aborted) return;
        const data = (await res.json()) as { files?: { externalCount: number }[] };
        if (controller.signal.aborted) return;
        const counts = base.map(() => 0);
        inspected.forEach(({ i }, k) => {
          counts[i] = data.files?.[k]?.externalCount ?? 0;
        });
        setExternalCounts(counts);
      })
      // The warning is advisory; a failed inspect just shows none.
      .catch(() => {});
    return () => {
      controller.abort();
      if (inspectAbort.current === controller) inspectAbort.current = null;
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
    if (accepted.length === 0 || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      // A dialog left open across the server's midnight shows yesterday's
      // names: re-check, and stop for a second look when the date moved. A
      // failed re-check drops the shown date to the placeholder — it can no
      // longer be vouched for — and the import goes ahead, its saved names
      // coming back in the answer, as when the date never arrived at all.
      const latest = await fetchServerDate(project);
      setServerDate(latest);
      if (latest && serverDate && latest !== serverDate) {
        alerts.warning("The date changed", {
          detail: `Imports are now named ${latest}-… — check the names and import again.`,
        });
        return;
      }
      // The warnings are advisory; once importing, the inspect upload is waste.
      inspectAbort.current?.abort();
      const body = new FormData();
      for (const { r, slug } of accepted) {
        body.append("files", r.file);
        body.append("slugs", slug);
      }
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
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [base, slugs, project, onImported, serverDate]);

  return { rows, acceptedCount, setSlug, submit, submitting, prefix, datePending };
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
