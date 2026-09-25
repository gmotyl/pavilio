import { useState } from "react";
import ViewerActions from "./ViewerActions";
import { workspaceRelativePath } from "./workspaceRelativePath";

/**
 * The widths the viewer can pin the frame to. `full` fills the pane; the
 * device widths are the CSS viewport widths a mockup is usually designed
 * against, so the author sees the same breakpoints the browser would pick.
 */
const WIDTHS = [
  { id: "full", label: "Full", width: "100%" },
  { id: "tablet", label: "Tablet", width: "768px" },
  { id: "phone", label: "Phone", width: "390px" },
] as const;

type WidthId = (typeof WIDTHS)[number]["id"];

export interface MockupFrameProps {
  /** Index-relative path, e.g. "pavilio/mockups/x.html". Drives the iframe src. */
  filePath: string;
  absolutePath: string;
  testIdPrefix?: string;
}

/**
 * The raw-file URL for a mockup. Each segment is encoded on its own so spaces
 * and `#` survive, while the separators stay literal slashes — the server's
 * `/raw/*path` wildcard matches on those, and encoding them breaks the route.
 */
const rawSrc = (filePath: string) =>
  `/api/files/raw/${filePath.split("/").map(encodeURIComponent).join("/")}`;

const BUTTON_CLASS =
  "text-sm px-2 py-1 rounded-md transition-colors cursor-pointer";

/** An HTML mockup rendered in a sandboxed frame, with a width picker above it. */
export function MockupFrame({
  filePath,
  absolutePath,
  testIdPrefix = "mockup-viewer",
}: MockupFrameProps) {
  const [widthId, setWidthId] = useState<WidthId>("full");
  const width = WIDTHS.find((w) => w.id === widthId)?.width ?? "100%";

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        data-testid={`${testIdPrefix}-toolbar`}
        className="flex items-center gap-2 mb-4 pb-3"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <span
          className="text-sm font-mono truncate flex-1 cursor-default"
          style={{ color: "var(--text-tertiary)" }}
        >
          {filePath.split("/").pop()}
        </span>
        {WIDTHS.map((w) => (
          <button
            key={w.id}
            data-testid={`${testIdPrefix}-width-${w.id}`}
            onClick={() => setWidthId(w.id)}
            className={BUTTON_CLASS}
            style={{
              color:
                widthId === w.id
                  ? "var(--text-primary)"
                  : "var(--text-secondary)",
              background:
                widthId === w.id ? "var(--bg-hover)" : "transparent",
            }}
          >
            {w.label}
          </button>
        ))}
        <ViewerActions
          absolutePath={absolutePath}
          // The path that means something inside an agent conversation, not the
          // machine-specific absolute one. VS Code still gets the absolute path.
          copyPathText={workspaceRelativePath(absolutePath, filePath)}
          testIdPrefix={testIdPrefix}
        />
      </div>
      {/* Centres the frame once a device width leaves it narrower than the pane. */}
      <div className="flex justify-center flex-1 min-h-0">
        {/* The width lives in `style` rather than in a key or a swapped wrapper
            element: React then keeps this exact iframe across a width change, so
            an interactive mockup does not reload and lose its state. */}
        <iframe
          data-testid={`${testIdPrefix}-frame`}
          src={rawSrc(filePath)}
          title={filePath}
          // No `allow-same-origin`: the mockup is untrusted markup from the
          // notes tree, and with it the frame could reach the panel's own origin.
          sandbox="allow-scripts"
          className="rounded-lg"
          style={{
            width,
            height: "100%",
            border: "1px solid var(--border-subtle)",
            background: "var(--bg-surface)",
          }}
        />
      </div>
    </div>
  );
}

export default MockupFrame;
