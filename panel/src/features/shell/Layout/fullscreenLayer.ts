import { useSyncExternalStore } from "react";

/**
 * Whether some routed view currently shows a fixed full-viewport layer (a
 * fullscreen mockup) that must paint over the shell's chrome.
 *
 * The routed-content scroll container is `isolate` so the sticky breadcrumb's
 * z-30 stays scoped below the sidebar toggles (3dda940). That same stacking
 * context caps any z-index inside it, so a `fixed z-[90]` layer would still
 * paint under the overlay, the sidebars, their toggles and the terminal
 * drawer. While a layer is held, `Layout` drops the isolation; the layer then
 * covers the breadcrumb anyway. A portal is not an option: it would re-mount
 * the iframe and an interactive mockup would lose its state.
 *
 * A count, not a flag, so two holders cannot release each other's hold.
 */
let holds = 0;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

/** Takes a hold; the returned release is idempotent. */
export function holdFullscreenLayer(): () => void {
  holds += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    emit();
  };
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useFullscreenLayerActive(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => holds > 0,
    () => false,
  );
}
