import { voiceForProject } from "../speech/voices";
import { projectOfSession } from "./sessionProject";

/**
 * The voice a cell speaks with, through the project its session belongs to;
 * a session the tab cannot place gets the default voice.
 *
 * Read-only, like {@link voiceForProject}: the answer pane and the control bar
 * call it during render. It lives with the terminal because placing a session
 * in its project is a terminal fact; speech receives it as the host's
 * `voiceFor` port.
 */
export function voiceForSession(sessionId: string): string {
  return voiceForProject(projectOfSession(sessionId) ?? undefined);
}
