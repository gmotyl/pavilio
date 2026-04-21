export type FaviconState = "busy" | "attention" | "idle";

interface StateStyle {
  color: string;
  glow: boolean;
}

const STATES: Record<FaviconState, StateStyle> = {
  busy: { color: "#ef4444", glow: true },
  attention: { color: "#22c55e", glow: true },
  idle: { color: "#ca8a04", glow: false },
};

export function buildFaviconSvg(state: FaviconState): string {
  const { color, glow } = STATES[state];
  const glowLayer = glow
    ? `<circle cx="16" cy="16" r="14" fill="${color}" opacity="0.35" filter="url(#g)" />`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5" /></filter></defs>${glowLayer}<circle cx="16" cy="16" r="9" fill="${color}" /></svg>`;
}

export function buildFaviconDataUrl(state: FaviconState): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(buildFaviconSvg(state))}`;
}
