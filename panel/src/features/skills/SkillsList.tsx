import { useNavigate, useLocation } from "react-router-dom";
import { FileText } from "lucide-react";
import { useSkills } from "./useSkills";

export default function SkillsList() {
  const skills = useSkills();
  const navigate = useNavigate();
  const location = useLocation();

  if (skills.length === 0) {
    return (
      <p className="text-xs px-1" style={{ color: "var(--text-muted)" }}>
        No skills found
      </p>
    );
  }

  return (
    <div className="text-sm">
      {skills.map((skill) => {
        const viewPath = `/view/_skills/${skill.name}`;
        const isActive = location.pathname === viewPath;
        return (
          <button
            key={skill.name}
            data-testid={`skills-list-${skill.name}`}
            onClick={() => navigate(viewPath)}
            title={skill.description || skill.name}
            className="flex items-center gap-1 w-full px-1 py-0.5 rounded-md text-xs truncate transition-colors duration-100"
            style={{
              color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
              background: isActive ? "var(--bg-active)" : "transparent",
            }}
            onMouseEnter={(e) => {
              if (!isActive)
                e.currentTarget.style.background = "var(--bg-hover)";
            }}
            onMouseLeave={(e) => {
              if (!isActive)
                e.currentTarget.style.background = isActive
                  ? "var(--bg-active)"
                  : "transparent";
            }}
          >
            <FileText
              size={13}
              className="shrink-0"
              style={{ color: "var(--text-tertiary)" }}
            />
            <span className="truncate">{skill.name}</span>
          </button>
        );
      })}
    </div>
  );
}
