# Project Setup Guide

This guide explains how to set up new projects with Claude Code integration and automatic session tracking.

## Quick Start

### 1. Create a New Project

```bash
./scripts/create-project.sh
```

The script will ask you:
- **Project name**: e.g., `my-web-app`, `client-api`
- **Project type**: personal, work, or freelance
- **AI Provider**: claude, kilocode, copilot, qwen, gemini, or custom
- **Team name** (optional): Your team name or "Solo"
- **Register in AGENTS.md?**: y/n

### 2. What Gets Created

```
my-web-app/
├── notes/
│   ├── notes/              # Session notes & decisions
│   │   └── .gitkeep
│   └── log/                # Meeting transcripts (optional)
│       └── .gitkeep
├── progress/               # Auto-populated on session end
│   └── .gitkeep
├── .agent/
│   ├── config.json         # Provider configuration
│   └── claude.md           # Claude Code setup (if using Claude)
├── PROJECT.md              # Project overview template
└── DECISIONS.md            # Key architectural decisions template
```

### 3. Understanding the Structure

**`notes/notes/`** - Where you keep session notes
- Use `/pavilio-memo` to capture quick thoughts
- Use `/pavilio-note` for meeting processing
- Store decisions and documentation here

**`progress/`** - Auto-created session tracking
- When you type `session end`, a file is created: `progress/[date]-slug.md`
- Contains: what was accomplished, next steps, blockers
- Auto-loaded when you `resume [project]`

**`.agent/config.json`** - Provider configuration
```json
{
  "provider": "claude",
  "provider_options": {},
  "features": [],
  "notifications": {
    "enabled": true,
    "style": "system-sounds"
  }
}
```

**`.agent/claude.md`** - Claude Code specific instructions (if using Claude)
- Auto-generated with project metadata
- References progress tracking structure

## Working with Claude Code

### Start a Session

```bash
cd my-web-app
claude  # or your configured Claude command
```

### Basic Commands

```
resume my-web-app      # Load last session context
session end            # Save session and create progress file
/pavilio-memo            # Quick note capture
/pavilio-note            # Process transcripts
/pavilio-question topic  # Search project knowledge
```

### Session Tracking

When you type `session end`:

1. A file is automatically created: `progress/2026-02-20-feature-implementation.md`
2. This file contains:
   - What you accomplished
   - Results/outcomes
   - Next steps and blockers
   - Useful context for next session

When you resume later:

```
resume my-web-app
```

Claude will automatically:
1. Load the most recent progress file
2. Read PROJECT.md for context
3. Display a formatted resume with last session details

## Registering in AGENTS.md

Your workspace has an `AGENTS.md` file that acts as a project registry. When you create a project, you can optionally register it:

```bash
./scripts/register-project.sh
```

Or the `create-project.sh` script will ask if you want to register.

This adds an entry like:
```
| my-web-app | work | claude | `notes/my-web-app/` | git/my-web-app |
```

**Benefits:**
- Agents (Claude Code, etc.) know what projects exist
- You can `resume my-web-app` from anywhere
- Commands like `/pavilio-note ch` work because the agent understands your project structure

## Project Types

### Personal
- Solo projects
- No team involvement
- Use when you're the only one working on this

### Work
- Client or employer projects
- May involve team collaboration
- Use for production systems

### Freelance
- Client work
- Usually standalone
- Track separately from personal/work

## Claude Code Integration

When using Claude Code with your project:

1. **First session**: Claude reads AGENTS.md and CLAUDE.md
2. **Understands your project structure**: Knows where notes, progress, etc. go
3. **Session tracking**: Automatically creates progress files
4. **Resuming**: `resume my-web-app` loads context from last session
5. **Commands work properly**: `/pavilio-note`, `/pavilio-memo`, etc. know the project structure

## Example Workflow

```bash
# Day 1: Create project
./scripts/create-project.sh
# (answer: my-app, work, claude, yes to register)

# Start working
cd my-app
claude

# In Claude...
> resume my-app        # Load any previous context
> [work on project]
> session end          # Save progress

---

# Day 2: Continue working
cd my-app
claude

# In Claude...
> resume my-app        # Load yesterday's progress
> [continue from where you left off]
```

## Multi-Project Workspace

You can organize multiple projects:

```
workspace/
├── AGENTS.md              # Global project registry
├── CLAUDE.md              # Global Claude configuration
├── my-web-app/            # Project 1
├── client-api/            # Project 2
└── scripts/               # Shared setup scripts
```

Use `resume [project-name]` to switch between projects.

## Troubleshooting

### Claude doesn't understand `/pavilio-note [project]`

Make sure:
1. `AGENTS.md` exists in the root
2. Project is registered in AGENTS.md
3. Project directory structure matches `notes/[project]/`

### Session files not being created

Make sure you're in the project directory when you type `session end`:
```bash
cd my-web-app
claude
# In Claude...
> session end          # Creates: my-web-app/progress/[date]-slug.md
```

### Can't resume project

Check that:
1. Progress files exist: `my-web-app/progress/*.md`
2. You're using the correct project name: `resume my-web-app`
3. AGENTS.md mentions the project

---

For more details on the workflow template, see [SETUP.md](../SETUP.md) and [ARCHITECTURE.md](../ARCHITECTURE.md).
