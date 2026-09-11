#!/usr/bin/env node
/*
 * Idempotent installer for the agent-response-speech emitters.
 *
 * One command, one pass per agent. Each supported agent is a *target*: a name,
 * the configuration root that proves the agent is installed at all, and an
 * install/uninstall pair. The top-level flow below walks the targets, skips the
 * ones whose root is absent, and prints exactly one line per agent saying what
 * happened. `--uninstall` is symmetric.
 *
 * Why per agent rather than per settings file: each half is independently
 * idempotent, so a partial install (claude today, codex installed next month)
 * converges on a re-run instead of conflicting. And one agent's failure is
 * contained — it is reported and the walk continues, so a broken ~/.claude
 * cannot stop codex and opencode from being registered.
 *
 * Registers each agent's finished-turn event only: Claude Code's `SubagentStop`
 * would fire once per subagent (a dozen times during an execute-plan run) and
 * `Notification` belongs to peon-ping.
 *
 * Run from the repo root as `pnpm install:speech` (add `--uninstall` to remove).
 */
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));

// HOME first so a test (or a scripted install into another account) can redirect
// the whole operation; homedir() is the fallback for platforms without HOME.
const home = process.env.HOME || homedir();

/**
 * A target failure that the walk reports and survives. Thrown instead of
 * exiting: exiting here would take the remaining agents down with it.
 */
class InstallError extends Error {}

function fail(message) {
  throw new InstallError(message);
}

// What a config file this installer had to invent gets. These files accumulate
// credentials — codex keeps MCP server definitions with plaintext tokens in
// them — and nothing but the owner's own agent ever reads one, so the group and
// world bits buy nothing and cost a disclosure. An existing file's mode always
// wins over this; it is only the no-information case.
const NEW_CONFIG_MODE = 0o600;

/**
 * Temp file + rename, so an interrupted run cannot truncate a real config.
 *
 * The rename lands a *new* inode, which is why the mode has to be carried over
 * explicitly: without this the user's 0600 config comes back 0644 and every
 * account on the machine can read their API tokens. The mode is stamped on the
 * temp file before the rename rather than on the target after it, so the
 * permissive window never exists at the real path.
 */
function writeFileAtomically(targetPath, text) {
  mkdirSync(dirname(targetPath), { recursive: true });
  // statSync, not existsSync-then-stat: one syscall, and a file that vanishes
  // between the two would otherwise throw where it should fall back.
  let mode = NEW_CONFIG_MODE;
  try {
    mode = statSync(targetPath).mode & 0o777;
  } catch {
    // No existing file to inherit from; the conservative default stands.
  }
  const tmpPath = `${targetPath}.install-speech-hook.tmp`;
  try {
    // `mode` on the write covers creation (umask still applies to it), chmod
    // then pins the exact bits — including on a stale temp file we reused.
    writeFileSync(tmpPath, text, { encoding: "utf8", mode });
    chmodSync(tmpPath, mode);
    renameSync(tmpPath, targetPath);
  } catch (err) {
    if (existsSync(tmpPath)) {
      try {
        unlinkSync(tmpPath);
      } catch {
        // Nothing useful to do; the real error is reported below.
      }
    }
    fail(`could not write ${targetPath} (${err.message}).`);
  }
}

/* ────────────────────────────── claude ────────────────────────────────────
 * Merges exactly one entry into ~/.claude/settings.json and removes exactly
 * that entry again on uninstall. Everything else in the file — other hooks,
 * other events, unrelated settings — is read, kept, and written back untouched.
 *
 * These five functions are the shipped single-agent installer, unchanged in
 * behaviour; only `fail()` differs, and only in that it now throws for the walk
 * to report rather than exiting the process outright.
 * ────────────────────────────────────────────────────────────────────────── */

const HOOK_EVENT = "Stop";
// Identity key: any Stop command referencing this file is ours, whatever the
// absolute prefix. Survives the workspace being moved or cloned elsewhere.
const HOOK_MARKER = "panel/hooks/speak-response.mjs";

// The hook is registered, not validated — a settings entry may legitimately
// point at a path that does not exist yet.
const hookPath = resolve(scriptDir, "..", "hooks", "speak-response.mjs");
const hookCommand = `node "${hookPath}"`;

const claudeRoot = join(home, ".claude");
const settingsPath = join(claudeRoot, "settings.json");

function readSettings() {
  if (!existsSync(settingsPath)) return {};
  const raw = readFileSync(settingsPath, "utf8");
  if (raw.trim() === "") return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    fail(
      `${settingsPath} is not valid JSON (${err.message}). Nothing was written — fix the file and run again.`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(
      `${settingsPath} does not hold a JSON object. Nothing was written — fix the file and run again.`,
    );
  }
  return parsed;
}

function isOurs(hook) {
  return (
    hook !== null &&
    typeof hook === "object" &&
    typeof hook.command === "string" &&
    hook.command.includes(HOOK_MARKER)
  );
}

/** Every Stop entry except ours, with our command pruned out of shared entries. */
function withoutOurHook(settings) {
  const hooks = { ...(settings.hooks ?? {}) };
  const stop = Array.isArray(hooks[HOOK_EVENT]) ? hooks[HOOK_EVENT] : [];
  const kept = [];
  for (const entry of stop) {
    if (entry === null || typeof entry !== "object" || !Array.isArray(entry.hooks)) {
      kept.push(entry);
      continue;
    }
    const remaining = entry.hooks.filter((hook) => !isOurs(hook));
    if (remaining.length === entry.hooks.length) kept.push(entry);
    else if (remaining.length > 0) kept.push({ ...entry, hooks: remaining });
    // An entry left with no commands was the wrapper we added; drop it.
  }

  if (kept.length > 0) hooks[HOOK_EVENT] = kept;
  else delete hooks[HOOK_EVENT];

  const next = { ...settings };
  if (Object.keys(hooks).length > 0) next.hooks = hooks;
  else delete next.hooks;
  return next;
}

function withOurHook(settings) {
  // Strip first, then append: a re-run refreshes the command in place instead of
  // stacking a second entry, and any duplicate from an earlier version collapses.
  const base = withoutOurHook(settings);
  const hooks = { ...(base.hooks ?? {}) };
  const stop = Array.isArray(hooks[HOOK_EVENT]) ? [...hooks[HOOK_EVENT]] : [];
  stop.push({ hooks: [{ type: "command", command: hookCommand }] });
  hooks[HOOK_EVENT] = stop;
  return { ...base, hooks };
}

function writeSettings(settings) {
  writeFileAtomically(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

const claudeTarget = {
  name: "claude",
  root: claudeRoot,
  install() {
    writeSettings(withOurHook(readSettings()));
    return `Registered the speech ${HOOK_EVENT} hook in ${settingsPath}\n  ${hookCommand}`;
  },
  uninstall() {
    // No settings file means no registration to strip — and writing one here
    // would create a file the user never had.
    if (!existsSync(settingsPath)) {
      return `Nothing to remove — ${settingsPath} does not exist.`;
    }
    writeSettings(withoutOurHook(readSettings()));
    return `Removed the speech ${HOOK_EVENT} hook from ${settingsPath}`;
  },
};

/* ────────────────────────────── codex ──────────────────────────────────────
 * Manages a marker-delimited block in ~/.codex/config.toml: append it if
 * absent, replace it wholesale if present, delete it on uninstall. Everything
 * outside the markers is copied through byte-for-byte.
 *
 * Why not parse the TOML: this repo has no TOML parser, and adding one to
 * parse-and-reserialise a user's config is a bad trade — it would lose comments
 * and blank lines across the *whole* file to rewrite six lines of it. A marker
 * block touches only what it owns. peon-ping already coexists in this same file
 * exactly this way, so the approach is proven in place.
 *
 * What is deliberately NOT written: anything under `[hooks.state]`. codex
 * records a `trusted_hash` there per hook and asks the user to trust a newly
 * registered command once. That gate exists so a human reads the command before
 * it runs; synthesising the hash would defeat it, and the hashing algorithm is
 * undocumented and unpinned besides. The installer registers the hook and says
 * the trust prompt is coming.
 * ────────────────────────────────────────────────────────────────────────── */

const CODEX_BEGIN = "# pavilio-speech begin";
const CODEX_END = "# pavilio-speech end";

const codexRoot = join(home, ".codex");
const codexConfigPath = join(codexRoot, "config.toml");

const codexHookPath = resolve(scriptDir, "..", "hooks", "speak-response-codex.mjs");
// What the user is shown. Deliberately the raw path: the report is there to be
// read against what is on disk, and escaping belongs to the file format, not to
// the human. Only the TOML literal below gets the escaped form.
const codexHookCommand = `node "${codexHookPath}"`;

// The path as it may appear *inside* a TOML basic string. That string type
// defines a closed set of escapes — \\ \" \b \f \n \r \t \uXXXX \UXXXXXXXX —
// and treats every other backslash sequence as a parse error. On Windows
// resolve() returns `C:\Users\…`, so splicing the path in raw would not merely
// fail to register the hook: `\U` makes the *whole* config.toml unparseable,
// taking down every unrelated key the user had in it, and codex reports nothing
// that points at this file. Backslashes first, then quotes — the other order
// would double the backslash that quote-escaping had just introduced, ending
// the string early. Usually a no-op on POSIX, but not only a Windows concern:
// both characters are legal in a POSIX filename, so a checkout under one of
// them corrupts the config exactly the same way.
const codexHookPathToml = codexHookPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const codexBlockLines = [
  CODEX_BEGIN,
  "[[hooks.Stop]]",
  "",
  "[[hooks.Stop.hooks]]",
  'type = "command"',
  // The inner quotes around the path are escaped for TOML, so a path
  // containing spaces still reaches the shell as one argument.
  `command = "node \\"${codexHookPathToml}\\""`,
  "timeout = 30",
  CODEX_END,
];

/**
 * Line ranges of every block of ours, in file order — empty when there are
 * none. `trimEnd()` tolerates a stray carriage return.
 *
 * Both ways a marker pair can be damaged are refused outright rather than
 * guessed at, because every guess available here deletes user content:
 *
 *  - an opening marker with no closing one would swallow the rest of the file;
 *  - a second opening marker *inside* a pair means the pairing is ambiguous —
 *    taking the outer one eats every key between the two markers, and taking
 *    the inner one leaves an orphan marker behind that breaks the next run.
 *
 * Refusing keeps one invariant across both: the installer never removes a line
 * it cannot prove it wrote. An unwritable case is reported and exits non-zero,
 * which is what the shipped code already did for the first of the two.
 */
function findCodexBlocks(lines) {
  const isMarker = (line, marker) => line.trimEnd() === marker;
  const blocks = [];
  let begin = -1;
  lines.forEach((line, i) => {
    if (isMarker(line, CODEX_BEGIN)) {
      if (begin !== -1) {
        fail(
          `${codexConfigPath} has a second "${CODEX_BEGIN}" marker (line ${i + 1}) inside the block opened at line ${begin + 1}. Nothing was written — fix the file and run again.`,
        );
      }
      begin = i;
    } else if (begin !== -1 && isMarker(line, CODEX_END)) {
      blocks.push({ begin, end: i });
      begin = -1;
    }
  });
  if (begin !== -1) {
    fail(
      `${codexConfigPath} has a "${CODEX_BEGIN}" marker with no matching "${CODEX_END}". Nothing was written — fix the file and run again.`,
    );
  }
  return blocks;
}

/**
 * Cuts every block out of `lines`, optionally putting `replacement` where the
 * first one stood. Taking back the one blank separator line above a removed
 * block is the exact inverse of how install appends one; the caller's own
 * blank lines above that are left alone.
 */
function spliceCodexBlocks(lines, blocks, replacement) {
  const out = [];
  let cursor = 0;
  blocks.forEach((block, i) => {
    const head = lines.slice(cursor, block.begin);
    if (i === 0 && replacement) {
      out.push(...head, ...replacement);
    } else {
      if (head.length > 0 && head[head.length - 1] === "") head.pop();
      out.push(...head);
    }
    cursor = block.end + 1;
  });
  out.push(...lines.slice(cursor));
  return out;
}

function readCodexConfig() {
  if (!existsSync(codexConfigPath)) return "";
  return readFileSync(codexConfigPath, "utf8");
}

function writeCodexConfig(text) {
  writeFileAtomically(codexConfigPath, text);
}

const codexTarget = {
  name: "codex",
  root: codexRoot,
  install() {
    const raw = readCodexConfig();
    // An absent or blank file becomes the block and nothing else — no invented
    // scaffolding around it.
    if (raw.trim() === "") {
      writeCodexConfig(`${codexBlockLines.join("\n")}\n`);
    } else {
      const lines = raw.split("\n");
      const blocks = findCodexBlocks(lines);
      if (blocks.length > 0) {
        // In place: whatever precedes and follows the block keeps its position.
        // Any further copies — an older installer stacked them, and two
        // registrations would speak every answer twice — are dropped here, so
        // install converges on one block however many it found.
        writeCodexConfig(spliceCodexBlocks(lines, blocks, codexBlockLines).join("\n"));
      } else {
        // Appended after one blank separator line — TOML tables must not run
        // into the previous table's keys, and the blank is what uninstall
        // takes back out again.
        const body = raw.endsWith("\n") ? raw : `${raw}\n`;
        writeCodexConfig(`${body}\n${codexBlockLines.join("\n")}\n`);
      }
    }
    return [
      `Registered the speech ${HOOK_EVENT} hook in ${codexConfigPath}`,
      `  ${codexHookCommand}`,
      "  codex will ask you to trust this hook once, the first time it fires.",
    ].join("\n");
  },
  uninstall() {
    // No config means no registration to strip — and writing one here would
    // create a file the user never had.
    if (!existsSync(codexConfigPath)) {
      return `Nothing to remove — ${codexConfigPath} does not exist.`;
    }
    const raw = readCodexConfig();
    const lines = raw.split("\n");
    const blocks = findCodexBlocks(lines);
    if (blocks.length === 0) {
      return `Nothing to remove — no pavilio-speech block in ${codexConfigPath}`;
    }
    // Every block is ours, so one uninstall takes them all: peeling off one
    // copy per run would leave a stacked file still speaking.
    writeCodexConfig(spliceCodexBlocks(lines, blocks, null).join("\n"));
    return `Removed the speech ${HOOK_EVENT} hook from ${codexConfigPath}`;
  },
};

/* ───────────────────────────── opencode ────────────────────────────────────
 * A symlink at ~/.config/opencode/plugins/pavilio-speech.ts pointing back at
 * the plugin in this checkout. opencode loads every file in that directory, so
 * the registration *is* the file's presence — there is no config to merge into.
 *
 * Why a link and not a copy: a copy is a fork. Every `pnpm pull` would leave
 * the user running last month's plugin with nothing anywhere saying so, and the
 * only cure would be remembering to re-run the installer. A link cannot go
 * stale, and when it does break it breaks loudly.
 *
 * Owned-link semantics. A link is *ours* when it resolves — or dangles — to a
 * path ending in the plugin's repo-relative suffix, exactly the way the claude
 * target recognises its own hook command by substring. That deliberately spans
 * more than this checkout: a link into a pavilio worktree that has since been
 * removed, or into a second clone, is still ours to repoint, and repointing it
 * is the only way a re-run from a new checkout can converge. Anything else —
 * a real file, a directory, a link into someone else's plugin — is left where
 * it is and reported. Refusing is a *report*, not a throw: someone else owning
 * this path is not a broken install, and it must not colour the exit status
 * that the claude and codex targets share.
 * ────────────────────────────────────────────────────────────────────────── */

// Identity key: any link resolving here is ours, whatever the absolute prefix.
const OPENCODE_PLUGIN_MARKER = "panel/hooks/speak-response-opencode.ts";

const opencodeRoot = join(home, ".config", "opencode");
const opencodePluginsDir = join(opencodeRoot, "plugins");
const opencodeLinkPath = join(opencodePluginsDir, "pavilio-speech.ts");
const opencodePluginPath = resolve(scriptDir, "..", "hooks", "speak-response-opencode.ts");

/**
 * What currently sits at the link path: `absent`, `ours` (with the absolute
 * path it points at), or `foreign` (with a phrase naming what it is, for the
 * report).
 *
 * lstat, not existsSync: a dangling link is still very much present at the
 * path, and existsSync — which follows the link — would call it absent and send
 * the caller into a symlink() that fails EEXIST.
 */
function inspectOpencodeLink() {
  let stats;
  try {
    stats = lstatSync(opencodeLinkPath);
  } catch {
    return { kind: "absent" };
  }
  if (!stats.isSymbolicLink()) {
    return { kind: "foreign", what: stats.isDirectory() ? "a directory" : "a real file" };
  }
  let raw;
  try {
    raw = readlinkSync(opencodeLinkPath);
  } catch (err) {
    fail(`could not read the link at ${opencodeLinkPath} (${err.message}).`);
  }
  // resolve() both absolutises a relative link (against the directory holding
  // it, which is what the kernel does) and normalises away any `..` segments,
  // so the suffix test sees a real path rather than a walk to one. It works on
  // the link *text*, so a dangling link is classified exactly like a live one.
  const target = resolve(opencodePluginsDir, raw);
  if (!target.endsWith(OPENCODE_PLUGIN_MARKER)) {
    return { kind: "foreign", what: `a symlink to ${target}` };
  }
  return { kind: "ours", target };
}

/**
 * The one directory this installer may have to invent. Its mode is inherited
 * from opencode's own config root rather than pinned to the 0600 that new
 * *files* get: a directory holds no content to disclose, and everything that
 * will ever land in it is either the user's own plugin code or a link to a
 * world-readable file in a git checkout. What matters instead is that it match
 * the tree it is being added to — a user who tightened ~/.config/opencode does
 * not want a wide-open directory appearing inside it, and one who did not would
 * be puzzled by a 0700 directory among 0755 siblings.
 */
function ensureOpencodePluginsDir() {
  if (existsSync(opencodePluginsDir)) return;
  let mode = 0o700;
  try {
    mode = statSync(opencodeRoot).mode & 0o777;
  } catch {
    // No root to inherit from — cannot normally happen, since its existence is
    // what selected this target — so the conservative default stands.
  }
  try {
    // mkdir's mode is filtered by the umask; the chmod pins the exact bits.
    mkdirSync(opencodePluginsDir, { recursive: true, mode });
    chmodSync(opencodePluginsDir, mode);
  } catch (err) {
    fail(`could not create ${opencodePluginsDir} (${err.message}).`);
  }
}

/**
 * Symlink + rename, the same shape as writeFileAtomically and for the same
 * reason: symlink() itself refuses to overwrite, so the obvious unlink-then-
 * symlink would leave the plugin missing outright if the process died between
 * the two. rename() replaces whatever is there in one step instead.
 */
function linkOpencodePlugin() {
  const tmpPath = `${opencodeLinkPath}.install-speech-hook.tmp`;
  try {
    try {
      unlinkSync(tmpPath);
    } catch {
      // No leftover from an interrupted run; nothing to clear.
    }
    symlinkSync(opencodePluginPath, tmpPath);
    renameSync(tmpPath, opencodeLinkPath);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // Nothing useful to do; the real error is reported below.
    }
    fail(`could not link ${opencodeLinkPath} (${err.message}).`);
  }
}

function opencodeNotOurs(found, verb) {
  return `Left ${opencodeLinkPath} alone — it is ${found.what}, which this installer does not own and will not ${verb}.`;
}

const opencodeTarget = {
  name: "opencode",
  root: opencodeRoot,
  install() {
    const found = inspectOpencodeLink();
    if (found.kind === "foreign") {
      return [
        opencodeNotOurs(found, "replace"),
        "  Move it aside and run again to link the speech plugin.",
      ].join("\n");
    }
    if (found.kind === "ours" && found.target === opencodePluginPath) {
      // Already exactly right. Relinking would be harmless but noisy, and the
      // report is more useful when it distinguishes the two.
      return `Already linked — ${opencodeLinkPath}\n  → ${opencodePluginPath}`;
    }
    ensureOpencodePluginsDir();
    linkOpencodePlugin();
    if (found.kind === "ours") {
      return [
        `Relinked the speech plugin at ${opencodeLinkPath}`,
        `  → ${opencodePluginPath}`,
        `  (was ${found.target})`,
      ].join("\n");
    }
    return `Linked the speech plugin into ${opencodeLinkPath}\n  → ${opencodePluginPath}`;
  },
  uninstall() {
    const found = inspectOpencodeLink();
    if (found.kind === "absent") {
      return `Nothing to remove — ${opencodeLinkPath} does not exist.`;
    }
    if (found.kind === "foreign") {
      return opencodeNotOurs(found, "remove");
    }
    try {
      unlinkSync(opencodeLinkPath);
    } catch (err) {
      fail(`could not remove ${opencodeLinkPath} (${err.message}).`);
    }
    // plugins/ itself stays: it is opencode's directory, not ours to delete,
    // and the user's own plugins may well be sitting in it.
    return `Removed the speech plugin link ${opencodeLinkPath}`;
  },
};

/* ──────────────────────────────── the walk ─────────────────────────────── */

const TARGETS = [claudeTarget, codexTarget, opencodeTarget];

const uninstalling = process.argv.slice(2).includes("--uninstall");

let anyFailed = false;

for (const target of TARGETS) {
  // The root is what proves the agent exists on this machine. Absent root ⇒
  // skipped and said so, never an error: not having codex installed is normal.
  if (!existsSync(target.root)) {
    console.log(`${target.name}: skipped — ${target.root} does not exist`);
    continue;
  }
  try {
    console.log(`${target.name}: ${uninstalling ? target.uninstall() : target.install()}`);
  } catch (err) {
    anyFailed = true;
    console.error(`install-speech-hook: ${target.name}: ${err.message}`);
  }
}

// Every agent got its turn; the exit status still reports that something broke.
process.exit(anyFailed ? 1 : 0);
