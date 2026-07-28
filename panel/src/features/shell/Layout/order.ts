/**
 * Flex `order` slots for the Layout row. Single source of truth: Layout places
 * the sidebars and <main>, TerminalDrawer picks one of the two drawer slots, and
 * both import from here so neither half can drift.
 *
 * Invariant: sidebarLeft < drawerLeft < main < drawerRight < sidebarRight —
 * the sidebars bracket everything, and the drawer docks just inside whichever
 * sidebar it is on.
 *
 * Numbering starts at 1 on purpose: the zero-width sidebar-toggle wrappers set
 * no order, so they keep the CSS default `order: 0` and stay ahead of the row.
 *
 * This module must not import from Layout or TerminalDrawer — Layout imports
 * TerminalDrawer, so anything they share has to be a leaf.
 */
export const LAYOUT_ORDER = {
  sidebarLeft: 1,
  drawerLeft: 2,
  main: 3,
  drawerRight: 4,
  sidebarRight: 5,
} as const;
