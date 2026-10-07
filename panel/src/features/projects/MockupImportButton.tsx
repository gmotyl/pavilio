import { useRef } from "react";
import { Upload } from "lucide-react";
import { MOCKUP_IMPORT_ACCEPT } from "./mockupFiles";

/**
 * Opens the OS file picker for mockup files. Picking hands the files to
 * `onFiles` — the dialog, not this button, decides what gets imported.
 */
export default function MockupImportButton({
  onFiles,
  testId,
}: {
  onFiles: (files: File[]) => void;
  /** The input is `${testId}-input`. */
  testId: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        data-testid={testId}
        onClick={() => inputRef.current?.click()}
        title="Import mockup files (SVG, PNG, JPEG, WebP, HTML)"
        className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors"
        style={{ color: "var(--text-secondary)" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <Upload size={13} /> Import
      </button>
      <input
        ref={inputRef}
        data-testid={`${testId}-input`}
        type="file"
        multiple
        accept={MOCKUP_IMPORT_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // Reset so picking the same file again still fires a change.
          e.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
    </>
  );
}
