import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  FolderOpen,
  GitBranch,
  HelpCircle,
  Settings,
  Smartphone,
  Star,
  Wifi,
} from "lucide-react";
import GitSummary from "../git/GitSummary";
import { MobileAccessModal } from "../mobile-access/MobileAccessModal";
import { LanAccessModal } from "../lan-access/LanAccessModal";
import { Toggle } from "../mobile-access/MobileAccessModal/Toggle";
import { useMobileAccessStatus } from "../mobile-access/useMobileAccessStatus";
import { useFavorites } from "../projects/useFavorites";
import { useProjects } from "../projects/useProjects";
import { TerminalNavList } from "../terminal/TerminalNavList";

function SectionHeader({
  icon: Icon,
  label,
}: {
  icon: typeof FolderOpen;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-2 px-1">
      <Icon size={12} style={{ color: "var(--text-tertiary)" }} />
      <h2
        className="text-[11px] font-semibold uppercase tracking-widest"
        style={{ color: "var(--text-tertiary)" }}
      >
        {label}
      </h2>
    </div>
  );
}

export default function LeftSidebar() {
  const navigate = useNavigate();
  const projects = useProjects();
  const { toggle, isFavorite, sortWithFavorites } = useFavorites();
  const [mobileAccessOpen, setMobileAccessOpen] = useState(false);
  const [lanAccessOpen, setLanAccessOpen] = useState(false);
  const anyModalOpen = mobileAccessOpen || lanAccessOpen;
  const {
    status: mobileStatus,
    enable: enableMobile,
    disable: disableMobile,
    enableLan,
    disableLan,
  } = useMobileAccessStatus(true, anyModalOpen ? 2000 : 30000);
  const mobileIsOn = mobileStatus?.tailscale.state === "on";
  const lanIsOn = mobileStatus?.lan.state === "on";
  const lanHasInterface =
    mobileStatus?.lan.state === "on" ||
    (mobileStatus?.lan.state === "off" && mobileStatus.lan.lanIp !== null);

  const onMobileToggle = (next: boolean) => {
    if (next) {
      enableMobile();
      setMobileAccessOpen(true);
    } else {
      disableMobile();
      setMobileAccessOpen(false);
    }
  };

  const onLanToggle = (next: boolean) => {
    if (next) {
      enableLan();
      setLanAccessOpen(true);
    } else {
      disableLan();
      setLanAccessOpen(false);
    }
  };

  const sorted = sortWithFavorites(projects);

  return (
    <div className="p-3 overflow-auto h-full flex flex-col gap-5 pt-10">
      <TerminalNavList />

      <section>
        <SectionHeader icon={FolderOpen} label="Projects" />
        <ul className="space-y-0.5">
          {sorted.map((project) => {
            const fav = isFavorite(project.name);
            return (
              <li key={project.name} className="flex items-center group">
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    toggle(project.name);
                  }}
                  className="p-1 rounded transition-colors shrink-0"
                  title={fav ? "Remove from favorites" : "Add to favorites"}
                >
                  <Star
                    size={12}
                    fill={fav ? "var(--accent)" : "none"}
                    style={{
                      color: fav ? "var(--accent)" : "var(--text-muted)",
                      opacity: fav ? 1 : 0,
                      transition: "all 150ms",
                    }}
                    className="group-hover:!opacity-100"
                  />
                </button>
                <NavLink
                  to={`/project/${project.name}`}
                  className={({ isActive }) =>
                    `block flex-1 text-[13px] px-1 py-1 rounded-md transition-all duration-150 ${isActive ? "font-medium" : ""}`
                  }
                  style={({ isActive }) => ({
                    color: isActive
                      ? "var(--text-primary)"
                      : "var(--text-secondary)",
                    background: isActive ? "var(--bg-active)" : "transparent",
                  })}
                >
                  {project.name}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-auto">
        <SectionHeader icon={GitBranch} label="Git" />
        <GitSummary />
      </section>

      <section className="px-1 pb-3 space-y-0.5">
        <button
          onClick={() => navigate("/view/_help/panel-guide.md")}
          className="flex items-center gap-2 w-full text-[12px] px-2 py-1.5 rounded-md transition-colors"
          style={{ color: "var(--text-muted)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-hover)";
            e.currentTarget.style.color = "var(--text-secondary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--text-muted)";
          }}
        >
          <HelpCircle size={14} />
          Help & Shortcuts
        </button>
        <button
          onClick={() => navigate("/settings")}
          className="flex items-center gap-2 w-full text-[12px] px-2 py-1.5 rounded-md transition-colors"
          style={{ color: "var(--text-muted)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-hover)";
            e.currentTarget.style.color = "var(--text-secondary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--text-muted)";
          }}
        >
          <Settings size={14} />
          Agent Settings
        </button>
        <div
          className="flex items-center gap-2 w-full text-[12px] px-2 py-1.5 rounded-md"
          style={{ color: "var(--text-muted)" }}
        >
          <button
            type="button"
            onClick={() => setMobileAccessOpen(true)}
            className="flex items-center gap-2 flex-1 text-left transition-colors"
            style={{ color: "inherit" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--text-secondary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-muted)";
            }}
            title={mobileIsOn ? "Show QR code" : "Enable to show QR code"}
          >
            <Smartphone size={14} />
            <span>Mobile access</span>
          </button>
          <Toggle
            on={mobileIsOn}
            onChange={onMobileToggle}
            label="Mobile access"
          />
        </div>
        <div
          className="flex items-center gap-2 w-full text-[12px] px-2 py-1.5 rounded-md"
          style={{ color: "var(--text-muted)" }}
        >
          <button
            type="button"
            onClick={() => setLanAccessOpen(true)}
            className="flex items-center gap-2 flex-1 text-left transition-colors"
            style={{ color: "inherit" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--text-secondary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-muted)";
            }}
            title={
              lanIsOn
                ? "Show LAN link"
                : lanHasInterface
                  ? "Enable to show LAN link"
                  : "No LAN interface detected"
            }
          >
            <Wifi size={14} />
            <span>LAN access</span>
          </button>
          <Toggle
            on={!!lanIsOn}
            onChange={onLanToggle}
            label="LAN access"
            disabled={!lanIsOn && !lanHasInterface}
          />
        </div>
      </section>
      {mobileAccessOpen && (
        <MobileAccessModal onClose={() => setMobileAccessOpen(false)} />
      )}
      {lanAccessOpen && (
        <LanAccessModal onClose={() => setLanAccessOpen(false)} />
      )}
    </div>
  );
}
