import {
  Bug, Box, BookOpen, Camera, Cloud, Code, Cog, Database, Flame, FlaskConical,
  Folder, Globe, Heart, Key, Leaf, Mail, Map, Music, Rocket, Shield,
  ShoppingCart, Terminal, Zap,
  type LucideIcon,
} from "lucide-react";
import { useSyncExternalStore } from "react";

import { preferences } from "../../preferences/declarations";
import { readPreference, subscribePreference } from "../../preferences/store";
import { useProjectColors } from "../terminal/useProjectColors";
import { parseProjectMark } from "./projectMark";

/** Registered short name (see PROJECT_MARK_ICONS) -> Lucide component. */
export const PROJECT_MARK_COMPONENTS: Record<string, LucideIcon> = {
  folder: Folder, rocket: Rocket, bolt: Zap, globe: Globe, cart: ShoppingCart,
  book: BookOpen, cog: Cog, flask: FlaskConical, shield: Shield, cloud: Cloud,
  heart: Heart, code: Code, db: Database, mail: Mail, map: Map, music: Music,
  leaf: Leaf, flame: Flame, cube: Box, key: Key, term: Terminal, bug: Bug,
  cam: Camera,
};

function useStoredMark(project: string): string {
  return useSyncExternalStore(
    (cb) => subscribePreference(preferences.projectMark, project, cb),
    () => readPreference(preferences.projectMark, project),
    () => "",
  );
}

export interface ProjectMarkProps {
  project: string;
  /** Live-preview override (`lucide:<name>` | `emoji:<glyph>` | ""); defaults to the stored mark. */
  mark?: string;
  /** Live-preview override; defaults to the stored or derived project colour. */
  color?: string;
  /** Tile edge in px. */
  size?: number;
}

export function ProjectMark({ project, mark, color, size = 22 }: ProjectMarkProps) {
  const { colorFor } = useProjectColors();
  const stored = useStoredMark(project);
  const hex = color ?? colorFor(project);
  const parsed = parseProjectMark(mark ?? stored);
  const emoji = parsed.startsWith("emoji:") ? parsed.slice(6) : null;
  const name = parsed.startsWith("lucide:") ? parsed.slice(7) : "folder";
  const Icon = PROJECT_MARK_COMPONENTS[name] ?? Folder;

  return (
    <span
      data-testid="project-mark"
      data-color={hex}
      aria-hidden="true"
      style={{
        display: "inline-grid",
        placeItems: "center",
        flex: "none",
        width: size,
        height: size,
        borderRadius: size >= 30 ? 8 : 6,
        fontSize: Math.round(size * 0.6),
        color: hex,
        background: `color-mix(in srgb, ${hex} 16%, transparent)`,
        border: `1px solid color-mix(in srgb, ${hex} 38%, transparent)`,
      }}
    >
      {emoji !== null ? (
        emoji
      ) : (
        <Icon data-testid={`project-mark-icon-${name}`} size="1em" strokeWidth={2} />
      )}
    </span>
  );
}
