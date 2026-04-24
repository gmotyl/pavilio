import { useState } from "react";
import { Copy, Check } from "lucide-react";

interface ClickableUrlProps {
  href: string;
}

export function ClickableUrl({ href }: ClickableUrlProps) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (insecure context etc.); fall back silently —
      // the link is still select-all-able.
    }
  };

  return (
    <div className="mt-3 flex items-start gap-2 w-full px-2">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[11px] font-mono select-all text-center break-all flex-1 hover:underline"
        style={{ color: "var(--text-secondary)" }}
      >
        {href}
      </a>
      <button
        onClick={onCopy}
        aria-label={copied ? "Copied" : "Copy link"}
        title={copied ? "Copied" : "Copy link"}
        className="shrink-0 p-1 rounded-md transition-colors"
        style={{
          color: copied ? "var(--accent)" : "var(--text-tertiary)",
          background: "transparent",
        }}
        onMouseEnter={(e) => {
          if (!copied) {
            e.currentTarget.style.color = "var(--text-primary)";
            e.currentTarget.style.background = "var(--bg-hover)";
          }
        }}
        onMouseLeave={(e) => {
          if (!copied) {
            e.currentTarget.style.color = "var(--text-tertiary)";
            e.currentTarget.style.background = "transparent";
          }
        }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  );
}
