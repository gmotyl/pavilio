import { useState, type ComponentType, type MouseEvent } from "react";
import { Copy, Check } from "lucide-react";
import { copyToClipboard } from "../../lib/clipboard";

interface Props {
  /** Text placed on the clipboard when clicked. */
  value: string;
  /** Tooltip + aria-label describing what gets copied. */
  label: string;
  /** Icon to show in the resting state (defaults to the clipboard glyph). */
  icon?: ComponentType<{ className?: string }>;
  "data-testid"?: string;
}

/**
 * Tiny inline copy-to-clipboard icon meant to sit directly next to the text it
 * copies, so it's obvious what lands on the clipboard. Flips to a green check
 * for 1.5s on success; disabled when there's nothing to copy.
 */
export function CopyIconButton({
  value,
  label,
  icon: Icon = Copy,
  "data-testid": testid,
}: Props) {
  const [copied, setCopied] = useState(false);

  const onClick = async (event: MouseEvent<HTMLButtonElement>) => {
    // Copying is never also a request to whatever the button happens to sit
    // inside. The answer pane once resolved any click in a spoken block to a
    // jump, so a copy button inside one — a fenced block nested in a list item
    // or a blockquote — restarted the voice. That handler is gone (reading now
    // starts from a Play button), but a copy button can still land inside an
    // ancestor that reacts to clicks, so the guard stays. Synchronous and
    // first: after an `await` the event is no longer dispatching. The same goes
    // for the browser's own default: an inline-code chip sits inside its link
    // when the span is the link text, and a copy must not also follow it.
    event.stopPropagation();
    event.preventDefault();
    if (!(await copyToClipboard(value))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onClick}
      disabled={!value}
      title={label}
      aria-label={label}
      className="flex items-center p-0.5 rounded transition-colors disabled:opacity-30 disabled:cursor-default"
      style={{ color: copied ? "var(--green)" : "var(--text-muted)" }}
      onMouseEnter={(e) => {
        if (!copied) e.currentTarget.style.color = "var(--text-primary)";
      }}
      onMouseLeave={(e) => {
        if (!copied) e.currentTarget.style.color = "var(--text-muted)";
      }}
    >
      {copied ? <Check className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
    </button>
  );
}

export default CopyIconButton;
