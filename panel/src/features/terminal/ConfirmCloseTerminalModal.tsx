import { useEffect, useRef } from "react";

interface Props {
  sessionName: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmCloseTerminalModal({
  sessionName,
  onCancel,
  onConfirm,
}: Props) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  // Parents pass inline callbacks, so their identity changes every render.
  // Route them through refs so the keydown effect can depend only on
  // sessionName — otherwise we'd re-focus the Close button on every parent
  // update and steal focus away from Cancel if the user Tab'd to it.
  const onCancelRef = useRef(onCancel);
  const onConfirmRef = useRef(onConfirm);

  useEffect(() => {
    onCancelRef.current = onCancel;
    onConfirmRef.current = onConfirm;
  });

  useEffect(() => {
    if (!sessionName) return;
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancelRef.current();
      } else if (e.key === "Enter") {
        // If a button is focused, let native activation handle it —
        // otherwise pressing Enter with Cancel focused would confirm.
        if (document.activeElement?.tagName === "BUTTON") return;
        e.preventDefault();
        onConfirmRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sessionName]);

  if (!sessionName) return null;

  return (
    <div
      data-testid="modal-backdrop"
      onClick={onCancel}
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
    >
      <div
        role="alertdialog"
        aria-labelledby="confirm-close-title"
        onClick={(e) => e.stopPropagation()}
        className="w-[90vw] max-w-[380px] rounded-lg p-4"
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
          color: "var(--text-primary)",
        }}
      >
        <h2
          id="confirm-close-title"
          className="text-[14px] font-semibold mb-1"
        >
          Close terminal "{sessionName}"?
        </h2>
        <p
          className="text-[12.5px] mb-4"
          style={{ color: "var(--text-secondary)" }}
        >
          The shell will be killed. Output is not saved.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-[12.5px]"
            style={{
              background: "var(--bg-base)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            Cancel
          </button>
          <button
            ref={closeBtnRef}
            autoFocus
            type="button"
            onClick={onConfirm}
            className="px-3 py-1.5 rounded-md text-[12.5px] font-semibold"
            style={{
              background: "var(--red, #f7768e)",
              color: "white",
              border: "1px solid var(--red, #f7768e)",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
