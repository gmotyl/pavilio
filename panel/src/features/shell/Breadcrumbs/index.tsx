import { useContext, type CSSProperties } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import {
  BreadcrumbActionsContext,
  BreadcrumbActionsProvider,
} from "./BreadcrumbActionsProvider";
import { HostBadge } from "../../host-mode/HostBadge";

interface Crumb {
  label: string;
  to?: string;
}

function parsePath(pathname: string): Crumb[] {
  if (pathname === "/") return [];

  const segments = pathname.split("/").filter(Boolean);

  if (segments[0] === "git") {
    return [{ label: "Git" }];
  }

  if (segments[0] === "settings") {
    return [{ label: "Agent Settings" }];
  }

  if (segments[0] === "project" && segments.length >= 2) {
    const name = segments[1];
    const crumbs: Crumb[] = [{ label: name, to: `/project/${name}` }];

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
      { label, to: isVirtual ? undefined : `/project/${label}` },
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

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const { actions } = useContext(BreadcrumbActionsContext);
  const crumbs = parsePath(pathname);

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
      className="flex items-center gap-1 px-6 py-2 text-xs"
      style={{ borderBottom: "1px solid var(--border-subtle)" }}
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

        return (
          <span key={index} className="flex items-center gap-1">
            <ChevronRight size={12} style={separatorStyle} />
            {isLast || !crumb.to ? (
              <span style={crumbTextStyle}>{crumb.label}</span>
            ) : (
              <Link
                to={crumb.to}
                style={crumbLinkStyle}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.color = "var(--text-primary)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.color = "var(--text-muted)")
                }
              >
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}

      {actions && (
        <div className="ml-auto flex items-center gap-1">{actions}</div>
      )}
    </nav>
  );
}

export { BreadcrumbActionsProvider };
export { useBreadcrumbActions } from "./useBreadcrumbActions";
