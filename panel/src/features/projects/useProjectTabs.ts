import {
  readLastReposQuery,
  readLastSectionFile,
} from "../shell/lastPath";

export interface ProjectTab {
  label: string;
  to: string;
  active: boolean;
  state?: { explicit: true };
}

interface Options {
  projectName: string | undefined;
  section: string | undefined;
  hasRepos: boolean;
}

const SECTIONS = ["iterm", "plans", "notes", "memo", "progress", "qa"];

export function useProjectTabs({
  projectName,
  section,
  hasRepos,
}: Options): { tabs: ProjectTab[]; activeTab: ProjectTab } {
  const sections = [...SECTIONS];
  if (hasRepos) sections.push("repos");
  const nonIterm = sections.filter((s) => s !== "iterm");
  const name = projectName ?? "";

  const tabs: ProjectTab[] = [
    {
      label: "iterm",
      to: `/project/${name}/iterm`,
      active: section === "iterm",
    },
    {
      label: "Overview",
      to: `/project/${name}`,
      active: !section,
      state: { explicit: true },
    },
    ...nonIterm.map<ProjectTab>((s) => {
      const base = `/project/${name}/${s}`;
      if (s === "repos") {
        const storedQuery = readLastReposQuery(name);
        return {
          label: s,
          to: storedQuery ? `${base}?${storedQuery}` : base,
          active: section === s,
        };
      }
      const storedFile = readLastSectionFile(name, s);
      return {
        label: s,
        to: storedFile
          ? `${base}?file=${encodeURIComponent(storedFile)}`
          : base,
        active: section === s,
      };
    }),
  ];

  return { tabs, activeTab: tabs.find((t) => t.active) || tabs[0] };
}
