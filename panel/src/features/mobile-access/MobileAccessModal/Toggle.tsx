export function Toggle({
  on,
  onChange,
  label,
  size = "sm",
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
  size?: "sm" | "md";
}) {
  const dims =
    size === "sm"
      ? { w: 24, h: 14, knob: 10 }
      : { w: 32, h: 18, knob: 14 };
  const pad = 2;
  const travel = dims.w - dims.knob - pad * 2;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
      className="relative shrink-0 rounded-full cursor-pointer transition-all duration-200"
      style={{
        width: dims.w,
        height: dims.h,
        background: on ? "var(--accent)" : "transparent",
        boxShadow: on
          ? "inset 0 0 0 1px var(--accent)"
          : "inset 0 0 0 1px var(--border-default)",
      }}
    >
      <span
        className="absolute rounded-full transition-all duration-200"
        style={{
          width: dims.knob,
          height: dims.knob,
          top: (dims.h - dims.knob) / 2,
          left: on ? travel + pad : pad,
          background: on ? "#0c0c0f" : "var(--text-tertiary)",
        }}
      />
    </button>
  );
}
