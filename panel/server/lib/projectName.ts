/**
 * Project names must be safe for use as a path component:
 * lowercase/uppercase letters, digits, hyphen, underscore. Length 1-64.
 * No path separators, no leading dots, no traversal characters.
 *
 * Returns null when valid; otherwise returns a short error message.
 */
export function validateProjectName(name: unknown): string | null {
  if (typeof name !== "string") return "project must be a string";
  if (name.length === 0 || name.length > 64) return "project name length must be 1-64";
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return "project name has invalid characters";
  return null;
}
