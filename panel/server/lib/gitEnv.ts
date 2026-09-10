/**
 * Git decides which repository it is talking to from the environment *before* it
 * looks at anything else: GIT_DIR and its siblings beat `git -C <dir>`, and they
 * beat the child process's own working directory. `cwd` is only consulted when
 * they are absent.
 *
 * That matters because git exports these to every hook it runs. In an ordinary
 * clone GIT_DIR is the relative string ".git", which harmlessly fails to resolve
 * somewhere else; in a *linked worktree* it is absolute, and then every git
 * command any hook launches — however carefully it passes `cwd` — silently
 * retargets the hook's repository instead.
 *
 * That is not hypothetical: a pre-push hook running the test suite from a linked
 * worktree had its sandboxed fixtures reinitialise the shared clone as bare and
 * commit fixture history onto main, which then reached the remote. Anything the
 * panel spawns can hit the same wall, because the panel itself may be launched
 * from a hook or from a shell that has these set.
 *
 * So: strip them, and let `cwd` genuinely decide.
 */

/**
 * The variables that relocate a git repository. Deliberately not the whole GIT_*
 * space — GIT_AUTHOR_NAME, GIT_SSH_COMMAND, GIT_TERMINAL_PROMPT and friends carry
 * real intent from the caller and must survive.
 */
export const GIT_LOCATION_VARS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
] as const;

/**
 * A copy of `base` with the repository-locating variables removed, for handing to
 * any child process that runs git — directly, or through a shell script that does.
 */
export function gitSafeEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const name of GIT_LOCATION_VARS) delete env[name];
  return env;
}
