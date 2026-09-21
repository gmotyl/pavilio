import { useRef, useState } from "react";
import { usePreference, type PreferenceSetter } from "../../preferences/usePreference";

import type { PreferenceDef } from "../../preferences/types";

/**
 * The project a Time-tab preference is scoped by, or `undefined` when there is
 * none yet.
 *
 * `ProjectTimePage` reads the route param as `name ?? ""`, so a blank project
 * genuinely reaches these components — and `storageKey` throws on a blank
 * scope by design, because an unresolved scope must read the declared default
 * and write nothing rather than put every project on one shared key.
 *
 * The `typeof` half is not decoration. Every blank-scope guard written as
 * `project.trim() === ""` became a NEW throw site the moment the value was
 * `undefined` rather than "", turning a render into a TypeError. The shape
 * that actually holds is this one.
 */
export function projectScope(project: string | undefined): string | undefined {
  return typeof project === "string" && project.trim() !== "" ? project : undefined;
}

/** Distinguishes the placeholder scopes below from one another. */
let unscopedInstances = 0;

/**
 * `usePreference` for a project-scoped preference whose project may not have
 * resolved.
 *
 * With no scope there is nothing to address, so the value lives in local state
 * seeded from the declared default: it renders and toggles, and nothing is read
 * or written. The bound hook is still called — hook order cannot depend on a
 * prop — under a placeholder scope unique to this component instance, so two
 * nameless projects can never meet on one key even if something later did
 * write.
 *
 * This mirrors `useOptionalScopePreference` in `features/git/GitBranchDiff`
 * rather than importing it: that one is private to the git surface and
 * repo-scoped, and a feature reaching across into another feature's component
 * module for a hook is the coupling neither wants.
 */
export function useProjectScopePreference<T>(
  def: PreferenceDef<T>,
  project: string | undefined,
): [T, PreferenceSetter<T>] {
  const scope = projectScope(project);
  const placeholder = useRef("");
  if (placeholder.current === "") {
    // A NUL prefix: no project name can collide with it.
    placeholder.current = `\u0000unscoped-time-${(unscopedInstances += 1)}`;
  }
  const bound = usePreference(def, scope ?? placeholder.current);
  const local = useState<T>(def.default);
  return scope === undefined ? local : bound;
}
