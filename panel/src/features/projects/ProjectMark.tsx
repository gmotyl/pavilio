import {
  Bug, Box, BookOpen, Camera, Cloud, Code, Cog, Database, Flame, FlaskConical,
  Folder, Globe, Heart, Key, Leaf, Mail, Map, Music, Rocket, Shield,
  ShoppingCart, Terminal, Zap,
  type LucideIcon,
} from "lucide-react";
import { useState, useSyncExternalStore, type ReactNode } from "react";

import type { ProjectKind } from "../../../server/lib/projects/kind";
import { preferences } from "../../preferences/declarations";
import { readPreference, subscribePreference } from "../../preferences/store";
import { useProjectColors } from "../terminal/useProjectColors";
import { markImageSrc, useMarkHash } from "./markImage";
import { parseProjectMark } from "./projectIdentity";

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
  /** Live-preview override (`lucide:<name>` | `emoji:<glyph>` | `image:mark.<ext>` | ""); defaults to the stored mark. */
  mark?: string;
  /** Live-preview override; defaults to the stored or derived project colour. */
  color?: string;
  /** Tile edge in px. */
  size?: number;
  /**
   * The project's kind. `research` draws a flask and `knowledge` a book in
   * place of the project's own mark; `project` (or absent) draws that mark.
   */
  kind?: ProjectKind;
}

/** Kinds that draw a fixed icon instead of the project's own mark. */
const KIND_MARKS: Partial<Record<ProjectKind, string>> = {
  research: "lucide:flask",
  knowledge: "lucide:book",
};

/** The stored mark image, filling the tile; `fallback` replaces it if it fails to load. */
function MarkImage({ src, fallback }: { src: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (failed) return fallback;
  return (
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }}
    />
  );
}

export function ProjectMark({ project, mark, color, size = 22, kind }: ProjectMarkProps) {
  const { colorFor } = useProjectColors();
  const stored = useStoredMark(project);
  const hex = color ?? colorFor(project);
  const parsed = parseProjectMark((kind && KIND_MARKS[kind]) ?? mark ?? stored);
  const emoji = parsed.startsWith("emoji:") ? parsed.slice(6) : null;
  const hash = useMarkHash(project);
  const image = parsed.startsWith("image:") ? markImageSrc(project, hash) : null;
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
      {image !== null ? (
        // Keyed by src: a new upload gets a fresh load (and a fresh failure state).
        <MarkImage
          key={image}
          src={image}
          fallback={<Icon data-testid={`project-mark-icon-${name}`} size="1em" strokeWidth={2} />}
        />
      ) : emoji !== null ? (
        emoji
      ) : (
        <Icon data-testid={`project-mark-icon-${name}`} size="1em" strokeWidth={2} />
      )}
    </span>
  );
}
