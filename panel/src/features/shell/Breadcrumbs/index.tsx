import {
  useContext,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import {
  BreadcrumbActionsContext,
  BreadcrumbActionsProvider,
} from "./BreadcrumbActionsProvider";
import { HostBadge } from "../../host-mode/HostBadge";
import { nameColor, usePanelTheme } from "../../projects/nameColor";
import { useProjectColors } from "../../terminal/useProjectColors";

interface Crumb {
  label: string;
  to?: string;
  /** Set on the crumb that names a project: it is drawn in that project's colour. */
  project?: string;
}

/** A path segment decoded once; a malformed escape stays as written. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function parsePath(pathname: string): Crumb[] {
  if (pathname === "/") return [];

  const segments = pathname.split("/").filter(Boolean);

  if (segments[0] === "git") {
    return [{ label: "Git" }];
  }

  if (segments[0] === "settings") {
    return [{ label: "Settings" }];
  }

  if (segments[0] === "project" && segments.length >= 2) {
    const name = segments[1];
    const crumbs: Crumb[] = [
      { label: name, to: `/project/${name}`, project: decodeSegment(name) },
    ];

    if (segments[2]) {
      crumbs.push({ label: segments[2] });
    }

    return crumbs;
  }

  if (segments[0] === "view" && segments.length >= 2) {
    const raw = segments[1];
    const isVirtual = raw.startsWith("_");
    const label = isVirtual ? raw.slice(1) : raw;
    const crumbs: Crumb[] = [
      {
        label,
        to: isVirtual ? undefined : `/project/${label}`,
        project: isVirtual ? undefined : decodeSegment(label),
      },
    ];
    const rest = segments.slice(2);
    const projectName = isVirtual ? null : raw;

    rest.forEach((seg, index) => {
      const isLast = index === rest.length - 1;
      let to: string | undefined;

      if (!isLast) {
        to =
          index === 0 && projectName
            ? `/project/${projectName}/${seg}`
            : `/view/${segments.slice(1, 3 + index).join("/")}`;
      }

      crumbs.push({ label: seg, to });
    });

    return crumbs;
  }

  return segments.map((seg, index) => ({
    label: seg,
    to:
      index < segments.length - 1
        ? "/" + segments.slice(0, index + 1).join("/")
        : undefined,
  }));
}

/**
 * The sticky offset for chrome that sticks right under the breadcrumb bar in
 * the same scroller: the bar's measured height, published by the bar itself as
 * `--breadcrumb-h` on its scroll container. The bar's height is not a constant
 * — page actions (the viewer's 28px buttons) make it taller than a bare row of
 * crumbs — so a fixed offset would leave the stuck chrome partly under the bar
 * or with a gap above it. With no bar (focus layout hides it) the variable is
 * unset and the offset falls back to the scroller's top.
 */
export const BELOW_BREADCRUMBS = "var(--breadcrumb-h, 0px)";

/**
 * Publish `nav`'s border-box height as `--breadcrumb-h` on its parent (the
 * scroll container it sticks in), kept current by a `ResizeObserver`, and
 * removed when the bar unmounts.
 */
function usePublishedHeight(nav: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = nav.current;
    const scroller = el?.parentElement;
    if (!el || !scroller) return;
    const publish = () =>
      scroller.style.setProperty("--breadcrumb-h", `${el.getBoundingClientRect().height}px`);
    publish();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      scroller.style.removeProperty("--breadcrumb-h");
    };
  }, [nav]);
}

interface BreadcrumbsProps {
  /** Shell controls at the row's right end, after the page's own actions. */
  trailing?: ReactNode;
}

export function Breadcrumbs({ trailing }: BreadcrumbsProps = {}) {
  const { pathname } = useLocation();
  const { actions } = useContext(BreadcrumbActionsContext);
  const crumbs = parsePath(pathname);
  const { colorFor } = useProjectColors();
  const theme = usePanelTheme();
  const navRef = useRef<HTMLElement>(null);
  usePublishedHeight(navRef);

  const homeStyle: CSSProperties = {
    color: "var(--text-muted)",
    display: "flex",
    alignItems: "center",
    transition: "color 150ms",
    textDecoration: "none",
  };

  const separatorStyle: CSSProperties = {
    color: "var(--text-muted)",
    flexShrink: 0,
  };

  const crumbLinkStyle: CSSProperties = {
    color: "var(--text-muted)",
    textDecoration: "none",
    transition: "color 150ms",
  };

  const crumbTextStyle: CSSProperties = {
    color: "var(--text-primary)",
  };

  return (
    <nav
      ref={navRef}
      className="sticky top-0 z-30 flex items-center gap-1 px-6 py-2 text-xs"
      style={{
        borderBottom: "1px solid var(--border-subtle)",
        background: "var(--bg-base)",
      }}
      aria-label="Breadcrumb"
    >
      <Link
        to="/"
        style={homeStyle}
        onMouseEnter={(e) =>
          (e.currentTarget.style.color = "var(--text-primary)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.color = "var(--text-muted)")
        }
        title="Dashboard"
      >
        <Home size={14} />
      </Link>

      <HostBadge />

      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1;
        // The project crumb keeps its project colour, also through a hover.
        const projectColor =
          crumb.project && crumb.project.trim() !== ""
            ? nameColor(colorFor(crumb.project), theme)
            : undefined;
        const restColor = projectColor ?? "var(--text-muted)";

        return (
          <span key={index} className="flex items-center gap-1">
            <ChevronRight size={12} style={separatorStyle} />
            {isLast || !crumb.to ? (
              <span
                style={
                  projectColor
                    ? { ...crumbTextStyle, color: projectColor }
                    : crumbTextStyle
                }
              >
                {crumb.label}
              </span>
            ) : (
              <Link
                to={crumb.to}
                style={{ ...crumbLinkStyle, color: restColor }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.color = projectColor
                    ? projectColor
                    : "var(--text-primary)")
                }
                onMouseLeave={(e) => (e.currentTarget.style.color = restColor)}
              >
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}

      {(actions || trailing) && (
        <div className="ml-auto flex items-center gap-1">
          {actions}
          {trailing}
        </div>
      )}
    </nav>
  );
}

export { BreadcrumbActionsProvider };
export { useBreadcrumbActions } from "./useBreadcrumbActions";
