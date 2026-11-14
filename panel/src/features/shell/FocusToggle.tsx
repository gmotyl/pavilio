import { useCallback } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { matchPath } from "react-router-dom";
import { preferences } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";
import { useIsMobile } from "./useIsMobile";
import { useSidebarState } from "./useSidebarState";

/**
 * The focus layout: the shell breadcrumb row and the project title row hidden,
 * so a project page starts at its tab row.
 *
 * `enabled` is the stored, global preference; `active` is whether it applies
 * right now. It never applies below `md`: the phone layout has no toggle to get
 * back out with, so both rows always render there whatever is stored.
 */
export function useFocusLayout() {
  const [enabled, setEnabled] = usePreference(preferences.focusLayout);
  const isMobile = useIsMobile();
  // An updater, so a shortcut and a click in one tick compose.
  const toggle = useCallback(() => setEnabled((on) => !on), [setEnabled]);
  return { enabled, active: enabled && !isMobile, toggle };
}

/**
 * Whether `pathname` is a project page — the only pages with a tab row to carry
 * the toggle once the breadcrumb row is gone. Every other page keeps its
 * breadcrumb row in focus, so it is never left without a way back.
 */
export function isFocusablePath(pathname: string): boolean {
  if (matchPath("/project/:name", pathname)) return true;
  const sectioned = matchPath("/project/:name/:section", pathname);
  // The time page is its own route, not a `ProjectView` tab.
  return Boolean(sectioned && sectioned.params.section !== "time");
}

/**
 * The control that flips the focus layout. Rendered in the breadcrumb row
 * normally and at the right end of the page-tab row in focus; nothing below
 * `md`, where focus does not apply.
 *
 * Both rows put it at the right end of `<main>`, in the same top band as the
 * right sidebar's collapsed toggle — which is viewport-anchored, so it lands on
 * this button's right edge. While that sidebar is collapsed the button steps
 * in by `.focus-toggle-sidebar-inset`; expanded, the sidebar toggle straddles
 * the seam and reaches too little into `<main>` to matter.
 */
export default function FocusToggle() {
  const { enabled, toggle } = useFocusLayout();
  const isMobile = useIsMobile();
  const rightSidebar = useSidebarState("rightSidebar");
  if (isMobile) return null;

  const label = enabled ? "Exit focus layout" : "Focus layout";
  const Icon = enabled ? Minimize2 : Maximize2;
  return (
    <button
      type="button"
      data-testid="focus-layout-toggle"
      onClick={toggle}
      aria-pressed={enabled}
      aria-label={label}
      title={`${label} (Alt+Shift+F)`}
      className={`flex items-center px-1.5 py-1 rounded-md transition-colors${
        rightSidebar.expanded ? "" : " focus-toggle-sidebar-inset"
      }`}
      style={{ color: enabled ? "var(--accent)" : "var(--text-tertiary)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <Icon size={14} />
    </button>
  );
}
