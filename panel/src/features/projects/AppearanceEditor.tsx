import { ImagePlus } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { preferences } from "../../preferences/declarations";
import { readPreference, subscribePreference, writePreference } from "../../preferences/store";
import { alerts } from "../alerts/store";
import { ProjectColorPicker } from "../terminal/ProjectColorPicker";
import { useProjectColors } from "../terminal/useProjectColors";
import { deleteMarkImage, markImageProblem, uploadMarkImage } from "./markImage";
import { nameColor, usePanelTheme } from "./nameColor";
import { PROJECT_MARK_COMPONENTS, ProjectMark } from "./ProjectMark";
import { PROJECT_MARK_EMOJI, PROJECT_MARK_ICONS, isSingleEmoji } from "./projectIdentity";

const EMOJI_HINT = "Enter exactly one emoji, e.g. 🚀";
const IMAGE_LIMITS = "PNG, SVG or WebP, up to 256 KB. Drop a file here or choose one. Shown square in the tile.";

type MarkTab = "icon" | "emoji" | "image";
const TABS: readonly { id: MarkTab; label: string }[] = [
  { id: "icon", label: "Icon" },
  { id: "emoji", label: "Emoji" },
  { id: "image", label: "Image" },
];
type EmojiCategory = keyof typeof PROJECT_MARK_EMOJI;
const EMOJI_CATEGORIES = Object.keys(PROJECT_MARK_EMOJI) as EmojiCategory[];

/** A picked, not yet uploaded, image file and its object URL for previews. */
interface PickedImage {
  file: File;
  url: string;
}

const btn = {
  border: "1px solid var(--border-subtle)",
  color: "var(--text-secondary)",
} as const;

function formatSize(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** A mark-shaped tile showing a picked file (the server copy does not exist yet). */
function PickedTile({ url, color, size }: { url: string; color: string; size: number }) {
  return (
    <span
      data-testid="appearance-picked-tile"
      aria-hidden="true"
      style={{
        display: "inline-grid",
        flex: "none",
        width: size,
        height: size,
        borderRadius: size >= 30 ? 8 : 6,
        overflow: "hidden",
        border: `1px solid color-mix(in srgb, ${color} 38%, transparent)`,
      }}
    >
      <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </span>
  );
}

/**
 * The project's Appearance: one collapsed row (mark tile, name, colour chip,
 * "Change appearance") that unfolds in place into the colour palette and the
 * Mark strip (Icon | Emoji | Image). Picks are staged in a draft and previewed
 * live by the row; Apply saves (uploading a picked image first), Cancel
 * discards — a picked image never leaves the browser until Apply.
 */
export default function AppearanceEditor({ project }: { project: string }) {
  const { colorFor, setColor } = useProjectColors();
  const theme = usePanelTheme();
  const storedMark = useSyncExternalStore(
    (cb) => subscribePreference(preferences.projectMark, project, cb),
    () => readPreference(preferences.projectMark, project),
    () => "",
  );
  const storedColor = colorFor(project);

  const [open, setOpen] = useState(false);
  const [color, setDraftColor] = useState(storedColor);
  const [mark, setDraftMark] = useState(storedMark);
  const [tab, setTab] = useState<MarkTab>("icon");
  const [category, setCategory] = useState<EmojiCategory>("Tech");
  const [emoji, setEmoji] = useState("");
  const [emojiError, setEmojiError] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedImage | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // Bumped on every fold and on unmount: an upload that resolves after its
  // editor session ended must not write the mark.
  const session = useRef(0);
  useEffect(() => () => {
    session.current += 1;
  }, []);

  // Release a picked file's object URL once it is replaced, dropped or unmounted.
  useEffect(() => () => {
    if (picked) URL.revokeObjectURL(picked.url);
  }, [picked]);

  const unfold = () => {
    setDraftColor(storedColor);
    setDraftMark(storedMark);
    setEmoji(storedMark.startsWith("emoji:") ? storedMark.slice(6) : "");
    setEmojiError(null);
    setPicked(null);
    setImageError(null);
    setOpen(true);
  };

  const fold = () => {
    session.current += 1;
    setPicked(null);
    setOpen(false);
  };

  const previewColor = open ? color : storedColor;
  const previewMark = open ? mark : storedMark;
  const previewPicked = open ? picked : null;
  const selectedIcon = previewMark.startsWith("lucide:")
    ? previewMark.slice(7)
    : previewMark.startsWith("emoji:") || previewMark.startsWith("image:")
      ? ""
      : "folder";
  const selectedEmoji = previewMark.startsWith("emoji:") ? previewMark.slice(6) : "";
  const hasImage = previewPicked !== null || previewMark.startsWith("image:");

  /** Stage an icon or emoji mark; it replaces any picked image. */
  const stageMark = (value: string) => {
    setPicked(null);
    setImageError(null);
    setDraftMark(value);
  };

  const pasteEmoji = (text: string) => {
    setEmoji(text);
    const glyph = text.trim();
    if (glyph === "") {
      setEmojiError(null);
    } else if (isSingleEmoji(glyph)) {
      setEmojiError(null);
      stageMark(`emoji:${glyph}`);
    } else {
      setEmojiError(EMOJI_HINT);
    }
  };

  const pickImage = (file: File | undefined) => {
    if (!file) return;
    const problem = markImageProblem(file);
    if (problem) {
      setImageError(problem);
      return;
    }
    setImageError(null);
    setPicked({ file, url: URL.createObjectURL(file) });
    setDraftMark(`image:mark.${file.name.toLowerCase().split(".").pop()}`);
  };

  const removeImage = () => {
    setPicked(null);
    setImageError(null);
    setDraftMark("");
  };

  const apply = async () => {
    if (picked) {
      const started = session.current;
      setBusy(true);
      try {
        const value = await uploadMarkImage(project, picked.file);
        if (session.current !== started) return;
        writePreference(preferences.projectMark, value, project);
      } catch (err) {
        if (session.current !== started) return;
        setImageError(err instanceof Error ? err.message : "Upload failed");
        // The error lives on the Image tab; show it wherever Apply was pressed.
        setTab("image");
        return;
      } finally {
        setBusy(false);
      }
    } else if (mark !== storedMark) {
      // Leaving an image mark: the file in the project folder goes with it.
      if (storedMark.startsWith("image:") && !mark.startsWith("image:")) {
        void deleteMarkImage(project).catch(() => {
          alerts.error(`Could not delete the mark image for ${project}`);
        });
      }
      writePreference(preferences.projectMark, mark, project);
    }
    if (color.toLowerCase() !== storedColor.toLowerCase()) {
      void setColor(project, color).catch(() => {
        alerts.error(`Could not save the colour for ${project}`);
      });
    }
    fold();
  };

  return (
    <div data-testid="appearance-editor">
      <div className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>
        Appearance
      </div>
      <div className="flex items-center gap-2" data-testid="appearance-row">
        {previewPicked ? (
          <PickedTile url={previewPicked.url} color={previewColor} size={28} />
        ) : (
          <ProjectMark project={project} mark={previewMark} color={previewColor} size={28} />
        )}
        <span
          data-testid="appearance-name"
          className="text-sm font-semibold truncate"
          style={{ color: nameColor(previewColor, theme) }}
        >
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
            if (e.key === "Escape") fold();
          }}
        >
          <ProjectColorPicker
            project={project}
            variant="inline"
            value={color}
            onPick={setDraftColor}
          />
          <div className="mt-3" role="group" aria-label="Mark">
            <div className="text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>
              Mark
            </div>
            <div
              role="tablist"
              className="flex gap-0.5 mb-2"
              style={{ borderBottom: "1px solid var(--border-subtle)" }}
            >
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  data-testid={`appearance-tab-${t.id}`}
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className="px-3 py-1.5 text-[12px]"
                  style={{
                    color: tab === t.id ? "var(--text-primary)" : "var(--text-secondary)",
                    borderBottom: `2px solid ${tab === t.id ? "var(--accent)" : "transparent"}`,
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {tab === "icon" && (
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
                      onClick={() => stageMark(`lucide:${name}`)}
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
            )}
            {tab === "emoji" && (
              <div>
                <div className="flex flex-wrap gap-1.5 mb-2" data-testid="appearance-emoji-cats">
                  {EMOJI_CATEGORIES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      data-testid={`appearance-emoji-cat-${c}`}
                      aria-pressed={category === c}
                      onClick={() => setCategory(c)}
                      className="rounded-full px-2.5 py-0.5 text-[11px]"
                      style={{
                        border: `1px solid ${category === c ? "var(--border-strong, var(--border-subtle))" : "var(--border-subtle)"}`,
                        background: category === c ? "var(--bg-active, transparent)" : "transparent",
                        color: category === c ? "var(--text-primary)" : "var(--text-secondary)",
                      }}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <div
                  data-testid="appearance-emoji-grid"
                  className="grid gap-1 overflow-y-auto p-0.5"
                  style={{ gridTemplateColumns: "repeat(auto-fill, minmax(34px, 1fr))", maxHeight: 120 }}
                >
                  {PROJECT_MARK_EMOJI[category].map((glyph) => {
                    const selected = glyph === selectedEmoji;
                    return (
                      <button
                        key={glyph}
                        type="button"
                        data-testid={`appearance-emoji-${glyph}`}
                        aria-label={glyph}
                        aria-pressed={selected}
                        onClick={() => {
                          setEmojiError(null);
                          stageMark(`emoji:${glyph}`);
                        }}
                        className="grid place-items-center rounded-md text-[18px]"
                        style={{
                          height: 34,
                          background: selected
                            ? `color-mix(in srgb, ${color} 22%, transparent)`
                            : "transparent",
                          boxShadow: selected ? `inset 0 0 0 1px ${color}` : "none",
                        }}
                      >
                        {glyph}
                      </button>
                    );
                  })}
                </div>
                <label
                  className="mt-2.5 flex items-center gap-1.5 text-[12px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  Or paste any emoji
                  <input
                    value={emoji}
                    placeholder="🚀"
                    onChange={(e) => pasteEmoji(e.target.value)}
                    className="w-14 rounded-md px-1.5 py-1 text-[14px]"
                    style={{
                      background: "var(--bg-base, rgba(0,0,0,0.25))",
                      border: `1px solid ${emojiError ? "var(--red, #f7768e)" : "var(--border-subtle)"}`,
                      color: "var(--text-primary)",
                    }}
                  />
                </label>
                {emojiError && (
                  <div role="alert" className="mt-1 text-[10px]" style={{ color: "var(--red, #f7768e)" }}>
                    {emojiError}
                  </div>
                )}
              </div>
            )}
            {tab === "image" && (
              <div>
                <div
                  data-testid="appearance-image-drop"
                  className="flex items-center gap-3.5 rounded-lg p-4"
                  style={{ border: "1px dashed var(--border-strong, var(--border-subtle))" }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    pickImage(e.dataTransfer.files[0]);
                  }}
                >
                  {previewPicked ? (
                    <span data-testid="appearance-image-preview">
                      <PickedTile url={previewPicked.url} color={color} size={48} />
                    </span>
                  ) : previewMark.startsWith("image:") ? (
                    <span data-testid="appearance-image-preview">
                      <ProjectMark project={project} mark={previewMark} color={color} size={48} />
                    </span>
                  ) : (
                    <span
                      aria-hidden="true"
                      className="grid place-items-center rounded-lg"
                      style={{ width: 48, height: 48, flex: "none", border: "1px dashed var(--border-subtle)", color: "var(--text-muted)" }}
                    >
                      <ImagePlus size={20} />
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="text-[13px] truncate" style={{ color: "var(--text-primary)" }}>
                      {previewPicked
                        ? `${previewPicked.file.name} · ${formatSize(previewPicked.file.size)}`
                        : previewMark.startsWith("image:")
                          ? previewMark.slice(6)
                          : "No image yet"}
                    </div>
                    <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                      {IMAGE_LIMITS}
                    </div>
                    <div className="mt-1.5 flex gap-3 text-[12px]">
                      <button
                        type="button"
                        data-testid="appearance-image-choose"
                        onClick={() => fileInput.current?.click()}
                        style={{ color: "var(--accent)" }}
                      >
                        {hasImage ? "Replace…" : "Choose…"}
                      </button>
                      {hasImage && (
                        <button type="button" data-testid="appearance-image-remove" onClick={removeImage} style={{ color: "var(--text-muted)" }}>
                          Remove
                        </button>
                      )}
                    </div>
                    <input
                      ref={fileInput}
                      type="file"
                      aria-label="Mark image file"
                      accept=".png,.svg,.webp,image/png,image/svg+xml,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        pickImage(e.target.files?.[0]);
                        // Let the same file be picked again after a Remove.
                        e.target.value = "";
                      }}
                    />
                  </div>
                </div>
                {imageError && (
                  <div
                    role="alert"
                    data-testid="appearance-image-error"
                    className="mt-1 text-[11px]"
                    style={{ color: "var(--red, #f7768e)" }}
                  >
                    {imageError}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" data-testid="appearance-cancel" onClick={fold} disabled={busy} className="rounded px-2 py-1 text-[11px]" style={btn}>
              Cancel
            </button>
            <button
              type="button"
              data-testid="appearance-apply"
              onClick={() => void apply()}
              disabled={busy}
              className="rounded px-2 py-1 text-[11px]"
              style={btn}
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
