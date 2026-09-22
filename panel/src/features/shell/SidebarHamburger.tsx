import { Menu } from "lucide-react";

/**
 * The left sidebar's open/close control, anchored to the VIEWPORT corner.
 *
 * Its predecessor computed a position — `left: 228 + drawerOffset("left")` —
 * where 228 was `240 - 12`, the sidebar's one-and-only width less the inset
 * that made the button straddle the seam. Once the sidebar's width became the
 * user's (180–400), that literal was wrong at every width but one: dragged out
 * to 400 the button sat 172px inside the pane it was supposed to straddle, and
 * a docked drawer needed a second correction on top.
 *
 * So this one computes nothing. It carries no inline style at all; `top` and
 * `left` are constants in `index.css`, resolved against the viewport. There is
 * no width, no dock side and no measurement anywhere in its geometry, which is
 * the whole point — and why it needs none of the `isDragging` transition guards
 * the seam-tracking controls do: a position that never changes cannot ease.
 *
 * It is NOT rendered inside the `<aside>`, even though that is where it appears
 * to sit when the sidebar is open. `.sidebar` is `overflow: hidden` and
 * `.sidebar-collapsed` is `pointer-events: none`, so a child would be clipped
 * away and made unclickable exactly when it is the only way back. What the
 * sidebar contributes instead is `<HamburgerSlot>` below.
 */
interface SidebarHamburgerProps {
  expanded: boolean;
  onToggle: () => void;
}

export default function SidebarHamburger({
  expanded,
  onToggle,
}: SidebarHamburgerProps) {
  const label = expanded ? "Collapse sidebar" : "Expand sidebar";

  return (
    <button
      type="button"
      data-testid="sidebar-hamburger"
      onClick={onToggle}
      className="sidebar-hamburger"
      aria-expanded={expanded}
      aria-label={label}
      title={label}
    >
      <Menu size={14} />
    </button>
  );
}

/**
 * The space the header row keeps for the button that floats above it.
 *
 * The two agree by construction rather than by coincidence: the slot is a box
 * of the same size, rendered as the leading item of the sidebar's first header
 * row, and `index.css` lines the fixed button up with where that slot lands. So
 * the heading beside it is never covered — and the alignment survives any width
 * the user drags the sidebar to, because neither box is derived from the width.
 */
export function HamburgerSlot() {
  return <span aria-hidden className="sidebar-hamburger-slot" />;
}
