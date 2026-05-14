import { FolderTree, Sparkles } from "lucide-react";
import SkillsList from "../skills/SkillsList";
import FileTree from "../explorer/FileTree";

export default function RightSidebar() {
  return (
    <div className="p-3 overflow-auto h-full pt-10 flex flex-col gap-5">
      <section>
        <div className="flex items-center gap-2 mb-2 px-1">
          <FolderTree size={12} style={{ color: "var(--text-tertiary)" }} />
          <h2
            className="text-[11px] font-semibold uppercase tracking-widest"
            style={{ color: "var(--text-tertiary)" }}
          >
            Explorer
          </h2>
        </div>
        <FileTree />
      </section>
      <section>
        <div className="flex items-center gap-2 mb-2 px-1">
          <Sparkles size={12} style={{ color: "var(--text-tertiary)" }} />
          <h2
            className="text-[11px] font-semibold uppercase tracking-widest"
            style={{ color: "var(--text-tertiary)" }}
          >
            Skills
          </h2>
        </div>
        <SkillsList />
      </section>
    </div>
  );
}
