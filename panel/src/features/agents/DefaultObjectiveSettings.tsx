import { useEffect, useState } from "react";

import { preferences } from "../../preferences/declarations";
import { clearPreference } from "../../preferences/store";
import { usePreference } from "../../preferences/usePreference";

/**
 * The workspace's task-run objective: the template every project resolves
 * unless it has its own override (edited from the Plans banner).
 *
 * It saves on blur, and only when the text changed, so focusing and leaving
 * the field writes nothing. An emptied field CLEARS the stored key rather than
 * storing `""` or copying the shipped text into it: a cleared key reads back as
 * the shipped default and keeps tracking it if a later release changes it.
 */
export function DefaultObjectiveSettings() {
  const [template, setTemplate] = usePreference(preferences.taskPromptDefault);
  const [draft, setDraft] = useState(template);

  // The stored value can change under an unfocused field — another tab's
  // write, or the clear below — so the draft follows it.
  useEffect(() => setDraft(template), [template]);

  const commit = () => {
    if (draft === template) return;
    if (draft.trim() === "") {
      clearPreference(preferences.taskPromptDefault);
      // A clear that finds nothing stored notifies no change; put the
      // displayed text back to what is now read either way.
      setDraft(preferences.taskPromptDefault.default);
      return;
    }
    setTemplate(draft);
  };

  return (
    <div>
      <label
        htmlFor="default-objective"
        className="block text-xs mb-1"
        style={{ color: "var(--text-muted)" }}
      >
        Default objective
      </label>
      <textarea
        id="default-objective"
        data-testid="default-objective"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        rows={2}
        className="w-full text-sm px-2 py-1 rounded font-mono resize-y"
        style={{
          background: "var(--bg-surface)",
          color: "var(--text-primary)",
          border: "1px solid var(--border-subtle)",
        }}
        spellCheck={false}
      />
      <p
        data-testid="default-objective-help"
        className="text-xs mt-1"
        style={{ color: "var(--text-muted)" }}
      >
        What a task run asks for, with <code>{"{change}"}</code>, <code>{"{path}"}</code> and{" "}
        <code>{"{project}"}</code> filled in at send time; a project can override it from the Plans
        banner. Empty it to restore the shipped default.
      </p>
    </div>
  );
}
