import { FolderTree, Sparkles } from "lucide-react";
import SkillsList from "../skills/SkillsList";
import FileTree from "../explorer/FileTree";
import CollapsibleSection from "./CollapsibleSection";

export default function RightSidebar() {
  return (
    <div className="p-3 overflow-auto h-full pt-10 flex flex-col gap-5">
      <CollapsibleSection
        storageKey="explorer"
        title="Explorer"
        icon={<FolderTree size={12} style={{ color: "var(--text-tertiary)" }} />}
      >
        <FileTree />
      </CollapsibleSection>
      <CollapsibleSection
        storageKey="skills"
        title="Skills"
        icon={<Sparkles size={12} style={{ color: "var(--text-tertiary)" }} />}
      >
        <SkillsList />
      </CollapsibleSection>
    </div>
  );
}
