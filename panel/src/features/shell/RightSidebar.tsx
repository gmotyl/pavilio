import { FolderTree, Sparkles, Terminal } from "lucide-react";
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
        <FileTree root="skills" />
      </CollapsibleSection>
      <CollapsibleSection
        storageKey="commands"
        title="Commands"
        icon={<Terminal size={12} style={{ color: "var(--text-tertiary)" }} />}
      >
        <div className="flex flex-col gap-3">
          <div>
            <h3
              className="text-[10px] uppercase tracking-wider px-1 mb-1"
              style={{ color: "var(--text-tertiary)" }}
            >
              .claude/commands
            </h3>
            <FileTree root="claude-commands" />
          </div>
          <div>
            <h3
              className="text-[10px] uppercase tracking-wider px-1 mb-1"
              style={{ color: "var(--text-tertiary)" }}
            >
              .opencode/commands
            </h3>
            <FileTree root="opencode-commands" />
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
}
