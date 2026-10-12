import { useState, useSyncExternalStore } from "react";

import { preferences } from "../../preferences/declarations";
import { readPreference, subscribePreference, writePreference } from "../../preferences/store";
import { alerts } from "../alerts/store";
import { ProjectColorPicker } from "../terminal/ProjectColorPicker";
import { useProjectColors } from "../terminal/useProjectColors";
import { PROJECT_MARK_COMPONENTS, ProjectMark } from "./ProjectMark";
import { PROJECT_MARK_ICONS, isSingleEmoji } from "./projectMark";

const EMOJI_HINT = "Enter exactly one emoji, e.g. 🚀";

const btn = {
  border: "1px solid var(--border-subtle)",
  color: "var(--text-secondary)",
} as const;

/**
 * The project's Appearance: one collapsed row (mark tile, name, colour chip,
 * "Change appearance") that unfolds in place into the colour palette and the
 * Mark strip. Picks are staged in a draft and previewed live by the row;
 * Apply saves, Cancel discards.
 */
export default function AppearanceEditor({ project }: { project: string }) {
  const { colorFor, setColor } = useProjectColors();
  const storedMark = useSyncExternalStore(
    (cb) => subscribePreference(preferences.projectMark, project, cb),
    () => readPreference(preferences.projectMark, project),
    () => "",
  );
  const storedColor = colorFor(project);

  const [open, setOpen] = useState(false);
  const [color, setDraftColor] = useState(storedColor);
  const [mark, setDraftMark] = useState(storedMark);
  const [tab, setTab] = useState<"icon" | "emoji">("icon");
  const [emoji, setEmoji] = useState("");
  const [emojiError, setEmojiError] = useState<string | null>(null);

  const unfold = () => {
    setDraftColor(storedColor);
    setDraftMark(storedMark);
    setEmoji(storedMark.startsWith("emoji:") ? storedMark.slice(6) : "");
    setEmojiError(null);
    setOpen(true);
  };

  const previewColor = open ? color : storedColor;
  const previewMark = open ? mark : storedMark;
  const selectedIcon = previewMark.startsWith("lucide:")
    ? previewMark.slice(7)
    : previewMark.startsWith("emoji:")
      ? ""
      : "folder";

  const useEmoji = () => {
    const glyph = emoji.trim();
    if (!isSingleEmoji(glyph)) {
      setEmojiError(EMOJI_HINT);
      return;
    }
    setEmojiError(null);
    setDraftMark(`emoji:${glyph}`);
  };

  const apply = () => {
    if (mark !== storedMark) writePreference(preferences.projectMark, mark, project);
    if (color.toLowerCase() !== storedColor.toLowerCase()) {
      void setColor(project, color).catch(() => {
        alerts.error(`Could not save the colour for ${project}`);
      });
    }
    setOpen(false);
  };

  return (
    <div data-testid="appearance-editor">
      <div className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>
        Appearance
      </div>
      <div className="flex items-center gap-2.5" data-testid="appearance-row">
        <ProjectMark project={project} mark={previewMark} color={previewColor} size={30} />
        <span className="text-sm truncate" style={{ color: "var(--text-primary)" }}>
          {project}
        </span>
        <span
          data-testid="appearance-chip"
          data-color={previewColor}
          className="inline-flex items-center gap-1 font-mono text-[11px]"
          style={{ color: "var(--text-muted)" }}
        >
          <span
            aria-hidden="true"
            className="inline-block w-3 h-3 rounded-sm"
            style={{ background: previewColor }}
          />
          {previewColor}
        </span>
        {!open && (
          <button
            type="button"
            onClick={unfold}
            data-testid="appearance-change"
            aria-expanded={false}
            className="ml-auto rounded px-2 py-1 text-[11px]"
            style={btn}
          >
            Change appearance
          </button>
        )}
      </div>

      {open && (
        <div
          data-testid="appearance-body"
          className="mt-3"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          <ProjectColorPicker
            project={project}
            variant="inline"
            value={color}
            onPick={setDraftColor}
          />
          <div className="mt-3" role="group" aria-label="Mark">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                Mark
              </span>
              <div role="tablist" className="flex gap-1">
                {(["icon", "emoji"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    data-testid={`appearance-tab-${t}`}
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className="rounded px-2 py-0.5 text-[11px]"
                    style={{
                      ...btn,
                      color: tab === t ? "var(--text-primary)" : "var(--text-muted)",
                    }}
                  >
                    {t === "icon" ? "Icon" : "Emoji"}
                  </button>
                ))}
              </div>
            </div>
            {tab === "icon" ? (
              <div className="grid grid-cols-8 gap-1" data-testid="appearance-icons">
                {PROJECT_MARK_ICONS.map((name) => {
                  const Icon = PROJECT_MARK_COMPONENTS[name];
                  const selected = name === selectedIcon;
                  return (
                    <button
                      key={name}
                      type="button"
                      title={name}
                      aria-label={name}
                      aria-pressed={selected}
                      data-testid={`appearance-icon-${name}`}
                      onClick={() => setDraftMark(`lucide:${name}`)}
                      className="grid place-items-center rounded p-1.5"
                      style={{
                        border: selected
                          ? "1px solid var(--text-secondary)"
                          : "1px solid transparent",
                        color: selected ? color : "var(--text-muted)",
                      }}
                    >
                      <Icon size={16} />
                    </button>
                  );
                })}
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-1">
                  <input
                    aria-label="Emoji"
                    value={emoji}
                    placeholder="🚀"
                    onChange={(e) => {
                      setEmoji(e.target.value);
                      setEmojiError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") useEmoji();
                    }}
                    className="w-20 rounded px-1.5 py-1 text-[13px]"
                    style={{
                      background: "var(--bg-base, rgba(0,0,0,0.25))",
                      border: `1px solid ${emojiError ? "var(--red, #f7768e)" : "var(--border-subtle)"}`,
                      color: "var(--text-primary)",
                    }}
                  />
                  <button type="button" data-testid="appearance-emoji-use" onClick={useEmoji} className="rounded px-2 py-1 text-[11px]" style={btn}>
                    Use emoji
                  </button>
                </div>
                {emojiError && (
                  <div role="alert" className="mt-1 text-[10px]" style={{ color: "var(--red, #f7768e)" }}>
                    {emojiError}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" data-testid="appearance-cancel" onClick={() => setOpen(false)} className="rounded px-2 py-1 text-[11px]" style={btn}>
              Cancel
            </button>
            <button type="button" data-testid="appearance-apply" onClick={apply} className="rounded px-2 py-1 text-[11px]" style={btn}>
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
