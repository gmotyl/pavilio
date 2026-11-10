# Agents

Pavilio does not ship an agent of its own: it gives the agents you already use
the workspace's skills as slash commands, and shows the sessions they run. Three
agents are supported — **Claude Code**, **opencode** and **Codex**.

## Skills for each agent

Every skill lives under [`skills/`](../skills/) as `skills/<name>/SKILL.md`.
`pnpm bootstrap` installs them for each agent already configured on this machine,
judged by the agent's config directory — it never creates one for an agent you do
not have, and reports that agent as skipped instead:

| Agent | Found by | Command | What it installs |
| --- | --- | --- | --- |
| Claude Code | `~/.claude` | `pnpm setup:claude-code` | one `.claude/commands/<name>.md` per skill, plus a link per skill in `~/.claude/skills/` |
| opencode | `~/.config/opencode`, or a local `.opencode/` | `pnpm setup:opencode` | one `.opencode/commands/<name>.md` wrapper per skill, registered in `opencode.json` and copied to `~/.config/opencode/commands/` when that exists |
| Codex | `$CODEX_HOME`, default `~/.codex` | `pnpm setup:codex` | a link per skill in `$CODEX_HOME/skills/`; list them in a session with `/skills` |

Each command is safe to re-run on its own. `setup:claude-code` and
`setup:opencode` remove what they generated for a skill listed in
`skills/RETIRED`; `setup:codex` instead prunes its own links into `skills/` that
no longer resolve. `pnpm setup:codex` leaves links it did not plant alone;
`pnpm setup:codex --force` replaces those too.

### Codex is not refreshed by sync or pull

After every update `pnpm sync` and `pnpm pull` re-run `setup:claude-code` when
the repo has a `.claude/` folder, and `setup:opencode` when the repo has a
`.opencode/` folder or `~/.config/opencode` exists, so those agents see the
current `skills/`. They do
**not** re-run `setup:codex`: after `skills/` changes, run `pnpm setup:codex`
yourself. See [Keep your notes safe](install.md#keep-your-notes-safe).

## Agent Tracking

The `scripts/ccl` and `scripts/oc` wrapper scripts launch Claude Code and OpenCode while registering the session in a shared registry file.

How it works:

1. Run `ccl` (or `scripts/ccl` when `scripts/` is not on your `PATH`) instead of `claude` — the wrapper captures the PID and writes an entry to `~/.agent-registry.json`
2. On exit, the wrapper removes the entry automatically
3. The panel sidebar polls the registry and shows live agent status

Registry format (`~/.agent-registry.json`):

```json
[
  {
    "pid": 12345,
    "type": "claude",
    "project": "my-project",
    "cwd": "/Users/you/workspace/projects/my-project",
    "startedAt": "2025-04-09T10:00:00Z"
  }
]
```

`type` is `claude` for `ccl` and `opencode` for `oc`; `project` is the name of the
directory the wrapper was started in. The panel drops entries whose process is no
longer running. The registry path is the panel's `agentRegistryPath` setting —
see [Configuration](configuration.md#panel-config).

Both wrappers start their agent without permission prompts: `ccl` runs
`claude --allow-dangerously-skip-permissions`, `oc` runs `opencode --agent yolo`.
Any further arguments are passed through. There is no wrapper for Codex.
