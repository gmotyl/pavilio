# Kilocode CLI Setup Guide

Kilocode is a terminal-first AI coding agent with support for 500+ LLM models.

## Installation

```bash
# Via npm
npm install -g @kilocode/cli

# Verify installation
kilo --version
```

## Getting Started

```bash
# Start Kilocode TUI
kilo

# Or run with a prompt
kilo run "your message here"

# Use specific mode
kilo ask "question about codebase?"
kilo debug "what's wrong with this?"
```

## Operating Modes

### Ask
Get answers about your codebase
```bash
kilo ask "What files handle authentication?"
```

### Debug
Identify and fix issues
```bash
kilo debug "Why is test failing?"
```

### Architect
Plan and structure changes
```bash
kilo architect "Design migration from X to Y"
```

### Orchestrator
Coordinate complex workflows
```bash
kilo orchestrator "Refactor, test, and document this module"
```

### Custom Modes
Define your own agent behaviors in `~/.config/kilo/opencode.json`

## Configuration

Global config: `~/.config/kilo/opencode.json`
Project config: `./opencode.json` (overrides global)

Example config:
```json
{
  "defaultModel": "gpt-4",
  "provider": "openai",
  "permissions": {
    "autoApproveReads": true,
    "autoApproveWrites": false
  }
}
```

## Model Switching

```bash
# See available models
kilo /models

# Switch models during session
/models
# Choose from 500+ options
```

## Autonomous Mode

For CI/CD pipelines:
```bash
kilo run --auto "Your task"
# Runs without user interaction
```

## Sound Notifications

Kilocode CLI can be configured with custom notifications via wrapper script.

## Using Kilocode with pavilio

1. Create project: `npm run create-project`
2. Choose "kilocode" as provider
3. Add to `.agent/config.json`:

```json
{
  "provider": "kilocode",
  "provider_options": {
    "model": "gpt-4",
    "mode": "ask"
  },
  "notifications": {
    "enabled": true,
    "style": "custom"
  }
}
```

4. Start using: `kilo ask "your question"`

## Tips

- Use Ask mode for quick code questions
- Use Debug mode for troubleshooting
- Use Architect mode for design discussions
- Use Orchestrator for multi-step workflows
- Switch models based on task complexity

## Documentation

- https://kilo.ai/docs
- https://kilo.ai/docs/cli
- https://github.com/Kilo-Org/kilocode

## Troubleshooting

**"Command not found: kilo"**
- Install globally: `npm install -g @kilocode/cli`

**"Model not available"**
- Check `/models` for available options
- Ensure credentials are configured

**"Autonomous mode fails"**
- Check permissions in config file
- Review error logs for details

---

See main README for switching between providers.
