import { Link, useLocation } from "react-router-dom";
import { Home, ChevronRight } from "lucide-react";
import { createContext, useContext, useState, type ReactNode, useEffect } from "react";

// --- Breadcrumb actions context ---
// Pages can inject right-side actions (e.g. VS Code, Path buttons) into the breadcrumb bar.

const BreadcrumbActionsContext = createContext<{
  actions: ReactNode;
  setActions: (node: ReactNode) => void;
}>({ actions: null, setActions: () => {} });

export function BreadcrumbActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode>(null);
  return (
    <BreadcrumbActionsContext.Provider value={{ actions, setActions }}>
      {children}
    </BreadcrumbActionsContext.Provider>
  );
}

/** Call from any page to inject actions into the breadcrumb bar's right side. */
export function useBreadcrumbActions(node: ReactNode, deps: unknown[]) {
  const { setActions } = useContext(BreadcrumbActionsContext);
  useEffect(() => {
    setActions(node);
    return () => setActions(null);
  }, deps);
}

// --- Route parsing ---

interface Crumb {
  label: string;
  to?: string;
}

function parsePath(pathname: string): Crumb[] {
  if (pathname === "/") return [];

  const segments = pathname.split("/").filter(Boolean);

  // /git → Home / Git
  if (segments[0] === "git") {
    return [{ label: "Git" }];
  }

  // /settings → Home / Agent Settings
  if (segments[0] === "settings") {
    return [{ label: "Agent Settings" }];
  }

  // /project/:name or /project/:name/:section
  if (segments[0] === "project" && segments.length >= 2) {
    const name = segments[1];
    const crumbs: Crumb[] = [{ label: name, to: `/project/${name}` }];
    if (segments[2]) {
      crumbs.push({ label: segments[2] });
    }
    return crumbs;
  }

  // /view/* — handle virtual prefixes (_skills, _help) and project files
  if (segments[0] === "view" && segments.length >= 2) {
    const raw = segments[1];
    const isVirtual = raw.startsWith("_");
    const label = isVirtual ? raw.slice(1) : raw;
    const crumbs: Crumb[] = [{ label, to: isVirtual ? undefined : `/project/${label}` }];
    // Each subfolder is a crumb, file name is the last (non-linked) crumb
    // First subfolder (notes, plans, progress) links to /project/:name/:section
    const rest = segments.slice(2);
    const projectName = isVirtual ? null : raw;
    rest.forEach((seg, i) => {
      const isLast = i === rest.length - 1;
      let to: string | undefined;
      if (!isLast) {
        to = i === 0 && projectName
          ? `/project/${projectName}/${seg}`
          : `/view/${segments.slice(1, 3 + i).join("/")}`;
      }
      crumbs.push({ label: seg, to });
    });
    return crumbs;
  }

  // Fallback: render each segment as a crumb
  return segments.map((seg, i) => ({
    label: seg,
    to: i < segments.length - 1 ? "/" + segments.slice(0, i + 1).join("/") : undefined,
  }));
}

// --- Component ---

export default function Breadcrumbs() {
  const { pathname } = useLocation();
  const { actions } = useContext(BreadcrumbActionsContext);
  const crumbs = parsePath(pathname);

  const homeStyle: React.CSSProperties = {
    color: "var(--text-muted)",
    display: "flex",
    alignItems: "center",
    transition: "color 150ms",
    textDecoration: "none",
  };

  const separatorStyle: React.CSSProperties = {
    color: "var(--text-muted)",
    flexShrink: 0,
  };

  const crumbLinkStyle: React.CSSProperties = {
    color: "var(--text-muted)",
    textDecoration: "none",
    transition: "color 150ms",
  };

  const crumbTextStyle: React.CSSProperties = {
    color: "var(--text-primary)",
  };

  return (
    <nav
      className="flex items-center gap-1 px-6 py-2 text-xs"
      style={{ borderBottom: "1px solid var(--border-subtle)" }}
      aria-label="Breadcrumb"
    >
      {/* Home icon — always a link to / */}
      <Link
        to="/"
        style={homeStyle}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
        title="Dashboard"
      >
        <Home size={14} />
      </Link>

      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight size={12} style={separatorStyle} />
            {isLast || !crumb.to ? (
              <span style={crumbTextStyle}>{crumb.label}</span>
            ) : (
              <Link
                to={crumb.to}
                style={crumbLinkStyle}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
              >
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}

      {/* Right-side actions injected by pages */}
      {actions && <div className="ml-auto flex items-center gap-1">{actions}</div>}
    </nav>
  );
}
