# Provider Configuration

Each AI agent provider has its own configuration file location and format. When you create a project, the appropriate files are generated automatically.

| Provider           | Config File(s)                        | Location           | Session Tracking      |
| ------------------ | ------------------------------------- | ------------------ | --------------------- |
| **Claude Code**    | `CLAUDE.md` + `.claude/settings.json` | Project root       | ✅ Auto (session end) |
| **Kilocode**       | `opencode.json`                       | Project root       | ✅ Auto (session end) |
| **GitHub Copilot** | `.github/copilot-instructions.md`     | Project `.github/` | ⚠️ Manual             |
| **QWEN**           | `.qwen/settings.json`                 | Project `.qwen/`   | ⚠️ Manual             |
| **Google Gemini**  | `.gemini/settings.json`               | Project `.gemini/` | ⚠️ Manual             |

## Notes

- Each provider expects its config files in **specific locations** — see [`PROVIDER-SETUP.md`](PROVIDER-SETUP.md).
- Claude Code is the only provider with automatic session tracking.
- Other providers require manual progress saving or custom scripts.
- Global settings live in `~/.claude/`, `~/.config/kilo/`, `~/.copilot/`, `~/.qwen/`, `~/.gemini/`.

## Setup Guide

See [`PROVIDER-SETUP.md`](PROVIDER-SETUP.md) for:

1. Correct file locations for each provider
2. Configuration file formats and examples
3. Global vs project-level configuration
4. Session tracking setup for each provider
5. Switching providers mid-project
