# Setup Guide

Get pavilio running in 20 minutes.

## Prerequisites

- Bash shell (macOS, Linux, WSL)
- Git
- Node.js 18+ (for npm scripts)
- Your chosen AI provider credentials (Claude, Kilocode, Copilot, QWEN, Gemini, etc.)

## Step 1: Clone Repository

```bash
git clone https://github.com/motyl-ai/pavilio
cd pavilio
```

## Step 2: Choose Your Providers

Decide which AI providers you want to support. You can add more later.

**Popular combinations:**
- **Solo dev, personal projects:** Kilocode CLI (free)
- **Solo dev, work + personal:** Claude Code (work) + Kilocode (personal)
- **Team lead, mixed work:** Copilot + Claude + integration tools

## Step 3: Run Master Setup

```bash
npm run setup:all
```

This interactive script will:
1. Ask which providers you want to setup
2. Ask for required credentials/API keys
3. Test connections to each provider
4. Create provider config files

## Step 4: Review Examples

Before creating your first project, review the examples:

```bash
# Personal project example
cat examples/example-personal-project/PROJECT.md
cat examples/example-personal-project/.agent/config.json

# Work project example
cat examples/example-work-project/PROJECT.md
cat examples/example-work-project/.agent/config.json
```

These show you the folder structure and how to configure different providers.

## Step 5: Create Your First Project

```bash
npm run create-project
```

Follow the interactive prompts:
- Project name: (e.g., "my-awesome-app")
- Project type: personal/work/freelance
- Provider: choose your AI provider
- Team: (optional, leave blank if solo)

Your project will be created with:
- Folder structure (notes, progress, .agent)
- PROJECT.md template
- DECISIONS.md template
- .agent/config.json configured for your provider

## Step 6: Start Using Your Project

```bash
cd my-awesome-project
```

Use your chosen AI agent (Claude, Kilo, Copilot, etc.) to start building.

## Troubleshooting

### "Command not found: npm"
Install Node.js: https://nodejs.org/

### "Permission denied: ./scripts/setup:all"
Make scripts executable:
```bash
chmod +x ./scripts/*.sh
chmod +x ./scripts/setup:*
```

### "Provider setup failed"
Check your credentials/API keys are correct. See provider-specific guides in `agents/`.

### "Can't find example projects"
Make sure you cloned the full repository:
```bash
git clone https://github.com/motyl-ai/pavilio
```

## Next Steps

- Read [docs/workflow.md](./docs/workflow.md) for day-to-day usage
- Check [docs/provider-selection.md](./docs/provider-selection.md) to understand provider options
- Review [agents/README.md](./agents/README.md) for provider-specific setup details
- Explore [docs/notebooklm-integration.md](./docs/notebooklm-integration.md) for architectural analysis

---

**Questions?** Open an issue on GitHub or check [docs/troubleshooting.md](./docs/troubleshooting.md)
