import { useRef, useState } from "react";
import { usePreference, type PreferenceSetter } from "../../preferences/usePreference";

import { asPreferenceScope, type PreferenceDef } from "../../preferences/types";

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
  const scope = asPreferenceScope(project);
  const placeholder = useRef("");
  if (placeholder.current === "") {
    // A NUL prefix: no project name can collide with it.
    placeholder.current = `\u0000unscoped-time-${(unscopedInstances += 1)}`;
  }
  const bound = usePreference(def, scope ?? placeholder.current);
  const local = useState<T>(def.default);
  return scope === undefined ? local : bound;
}
