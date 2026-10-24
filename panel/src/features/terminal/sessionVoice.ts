import { voiceForProject } from "../speech/voices";
import { projectOfSession } from "./sessionProject";

const DOC_KEY_PREFIX = "doc:";

/**
 * The project a page's `doc:<projects-relative path>` key belongs to: the
 * path's first segment. A file outside projects (no directory) has none.
 */
function projectOfDocKey(key: string): string | null {
  const path = key.slice(DOC_KEY_PREFIX.length);
  const slash = path.indexOf("/");
  return slash > 0 ? path.slice(0, slash) : null;
}

/**
 * The voice a cell speaks with, through the project its session belongs to;
 * a session the tab cannot place gets the default voice. A page's `doc:` key
 * speaks with the voice of the project its path lives in.
 *
 * Read-only, like {@link voiceForProject}: the answer pane and the control bar
 * call it during render. It lives with the terminal because placing a session
 * in its project is a terminal fact; speech receives it as the host's
 * `voiceFor` port.
 */
export function voiceForSession(sessionId: string): string {
  const project = sessionId.startsWith(DOC_KEY_PREFIX)
    ? projectOfDocKey(sessionId)
    : projectOfSession(sessionId);
  return voiceForProject(project ?? undefined);
}
