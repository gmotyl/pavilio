/**
 * A project's identity: the mark it wears and the colour it falls back to.
 *
 * A LEAF MODULE ON PURPOSE. `preferences/declarations.ts` imports the mark
 * codec from here at runtime, so nothing in this file may import a feature (or
 * the registry) back.
 */

/**
 * The colours a project can wear. The first six are the ones the old
 * per-session palette used, in their original order, so today's assignments do
 * not shift. `ProjectColorPicker` re-exports this list.
 */
export const PROJECT_COLOR_PRESETS: readonly { name: string; hex: string }[] = [
  { name: "Gold", hex: "#f0c674" },
  { name: "Coral", hex: "#e06c75" },
  { name: "Purple", hex: "#c678dd" },
  { name: "Blue", hex: "#61afef" },
  { name: "Teal", hex: "#56b6c2" },
  { name: "Green", hex: "#98c379" },
  { name: "Orange", hex: "#d19a66" },
  { name: "Olive", hex: "#b5bd68" },
  { name: "Emerald", hex: "#5fd7a7" },
  { name: "Indigo", hex: "#7d8ff5" },
  { name: "Pink", hex: "#ec7fa9" },
  { name: "Slate", hex: "#8fa3bf" },
];

export const PROJECT_COLOR_HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * The 23 curated icons, by the short names the identity mockup uses. The
 * `ProjectMark` tile maps each to its Lucide component; this list is the only
 * thing that decides what `lucide:<name>` may hold.
 */
export const PROJECT_MARK_ICONS: readonly string[] = [
  "folder", "rocket", "bolt", "globe", "cart", "book", "cog", "flask",
  "shield", "cloud", "heart", "code", "db", "mail", "map", "music",
  "leaf", "flame", "cube", "key", "term", "bug", "cam",
];

/**
 * The curated emoji the Appearance editor offers as a tappable grid, by
 * category (20 each). Anything else can still be pasted; every entry here must
 * pass `isSingleEmoji` (text-default glyphs carry VS16).
 */
export const PROJECT_MARK_EMOJI: Readonly<
  Record<"Tech" | "Objects" | "Nature" | "Food" | "Symbols" | "Faces", readonly string[]>
> = {
  Tech: [
    "💻", "🖥️", "⌨️", "🖱️", "📱", "🔌", "🔋", "💾", "💿", "📡",
    "🛰️", "🤖", "🧠", "🧪", "🔬", "⚙️", "🔧", "🛠️", "🧰", "🚀",
  ],
  Objects: [
    "📦", "📚", "📝", "📌", "📎", "🔑", "🔒", "💡", "🔦", "🧭",
    "⏰", "📷", "🎥", "🎧", "🎨", "🎯", "🎲", "🧩", "🏆", "💎",
  ],
  Nature: [
    "🌱", "🌿", "🍀", "🌲", "🌵", "🌸", "🌻", "🌊", "🔥", "⚡",
    "🌙", "⭐", "☀️", "🌈", "❄️", "🐝", "🦋", "🐙", "🦊", "🐢",
  ],
  Food: [
    "🍎", "🍋", "🍉", "🍇", "🍓", "🍒", "🥑", "🌶️", "🥕", "🍄",
    "🍞", "🧀", "🍕", "🍔", "🌮", "🍣", "🍩", "🍪", "☕", "🍵",
  ],
  Symbols: [
    "❤️", "💜", "💙", "💚", "💛", "🧡", "✅", "❌", "⚠️", "♻️",
    "🔴", "🟢", "🔵", "🟣", "🔶", "🔷", "✨", "💬", "🔔", "🏁",
  ],
  Faces: [
    "😀", "😎", "🤓", "🥳", "😇", "🤔", "😴", "🤯", "🥶", "🤠",
    "👻", "👽", "👾", "💀", "🎃", "😺", "🐶", "🐱", "🦄", "🐼",
  ],
};

/**
 * FNV-1a over the name's UTF-16 code units. Hand-rolled rather than anything
 * locale- or engine-dependent, so one name gets one colour on every machine.
 */
function hashName(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The colour a project wears when none is stored. Nothing is ever written for it. */
export function derivedProjectColor(name: string): string {
  return PROJECT_COLOR_PRESETS[hashName(name) % PROJECT_COLOR_PRESETS.length].hex;
}

/**
 * What may open an emoji grapheme: a keycap, a flag, a glyph that is an emoji
 * by default, or a text-default pictograph that is made one by VS16 (U+FE0F)
 * or a skin-tone modifier. A bare ©, ™ or ▶ is text, so it does not pass.
 */
const EMOJI_RE =
  /^(?:[0-9#*]\uFE0F?\u20E3|\p{Regional_Indicator}{2}|\p{Emoji_Presentation}|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}))/u;

/** Whether `text` is exactly one grapheme and that grapheme is an emoji. */
export function isSingleEmoji(text: string): boolean {
  if (text === "") return false;
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const segments = [...segmenter.segment(text)];
  return segments.length === 1 && EMOJI_RE.test(text);
}

/**
 * The stored mark image, by one of its three fixed file names in the project's
 * notes folder. Never a path: the server only ever writes `mark.<ext>`.
 */
const MARK_IMAGE_RE = /^image:mark\.(?:png|svg|webp)$/;

/**
 * `"" | "lucide:<registered name>" | "emoji:<one emoji grapheme>" |
 * "image:mark.<png|svg|webp>"`. Anything else — wrong type, unknown icon, two
 * emoji, plain text, any other image name or path — parses to `""`.
 */
export function parseProjectMark(raw: unknown): string {
  if (typeof raw !== "string") return "";
  if (raw.startsWith("lucide:")) {
    return PROJECT_MARK_ICONS.includes(raw.slice(7)) ? raw : "";
  }
  if (raw.startsWith("emoji:")) {
    return isSingleEmoji(raw.slice(6)) ? raw : "";
  }
  if (raw.startsWith("image:")) {
    return MARK_IMAGE_RE.test(raw) ? raw : "";
  }
  return "";
}
