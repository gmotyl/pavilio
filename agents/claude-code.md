# Claude Code Setup Guide

Claude Code is Claude's command-line interface for interactive coding, planning, and debugging.

## Installation

```bash
# Via npm (recommended)
npm install -g @anthropic-ai/claude-code

# Or via uvx (no installation needed)
uvx @anthropic-ai/claude-code
```

## Getting Started

```bash
# Start Claude Code
claude-code

# Or in a directory
cd my-project
claude-code
```

## Configuration

Claude Code configuration is typically stored in:
- `~/.config/claude-code/config.json` (global config)
- `.claude/` directory (project-specific)

## Features

- **Interactive coding:** Get real-time suggestions and complete features
- **Planning:** Architectural discussions and implementation planning
- **Debugging:** Identify and fix bugs with AI assistance
- **Code review:** Get feedback on your code
- **Testing:** Generate and run tests

## Sound Notifications (peon-ping)

Claude Code integrates with peon-ping for sound notifications.

### Setup peon-ping

```bash
# Install peon-ping
npm install -g peon-ping

# Or use it directly with npx
npx peon-ping
```

### Notification Sounds

Default sounds (Peasant):
- `start.mp3` - "Ready" sound (play when starting work)
- `done.mp3` - "Yes" sound (play when task completes)
- `question.mp3` - "What?" sound (play before asking questions)

Get sounds from: https://peon-ping.vercel.app/

## Using Claude Code with pavilio

1. Create project: `npm run create-project`
2. Choose "claude" as provider
3. Add to `.agent/config.json`:

```json
{
  "provider": "claude",
  "provider_options": {
    "model": "claude-3-5-sonnet"
  },
  "notifications": {
    "enabled": true,
    "style": "peon-ping"
  }
}
```

4. Start using Claude Code: `claude-code`

## Tips

- Use Claude Code's planning feature before implementation
- Leverage architectural discussions for complex refactors
- Use debugging mode for troubleshooting
- Reference project context with `@file` syntax

## Documentation

- https://claude.com/claude-code
- https://github.com/anthropics/claude-code

## Troubleshooting

**"Command not found: claude-code"**
- Install globally: `npm install -g @anthropic-ai/claude-code`

**"API key not found"**
- Set ANTHROPIC_API_KEY: `export ANTHROPIC_API_KEY='your-key'`

**Notifications not working**
- Install peon-ping: `npm install -g peon-ping`
- Check sound files are in correct location

---

See main README for switching between providers.
