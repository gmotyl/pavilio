# Architecture Overview

## Design Principles

### 1. Provider-Agnostic
Not locked to any single AI provider. Works with Claude Code, Kilocode CLI, Copilot, QWEN, Gemini, and any other agent.

### 2. Per-Project Provider Selection
Each project specifies which provider to use in `.agent/config.json`. Easy to switch later.

### 3. Consistent Folder Structure
Same folder structure for all projects, regardless of provider:
- `notes/` - Session notes, meeting transcripts
- `progress/` - Session tracking, standup preparation
- `.agent/` - Provider configuration
- `PROJECT.md` - Project overview
- `DECISIONS.md` - Key architectural decisions

### 4. Separation of Concerns
- **Providers** - AI agents (Claude, Kilo, Copilot, etc.)
- **Integrations** - External tools (Todoist, GitHub, Jira, Azure DevOps)
- **Projects** - User projects using providers + integrations
- **Documentation** - Guides for setup, usage, troubleshooting

## Folder Structure

```
pavilio/
├── examples/               # Reference implementations
├── scripts/                # Setup + utility scripts
├── templates/              # Scaffolding templates
├── agents/                 # Provider guides
├── skills/                 # Claude Code skills
├── docs/                   # Comprehensive documentation
└── [user projects]/        # Your projects (created with create-project.sh)
```

## Project Structure

Each project created with `create-project.sh` has:

```
my-project/
├── notes/                  # Session notes
├── progress/               # Session tracking (YYYY-MM-DD-slug.md)
├── .agent/
│   └── config.json         # Provider configuration
├── PROJECT.md              # Project overview
├── DECISIONS.md            # Key decisions
└── [project files]         # Your code, docs, etc.
```

### .agent/config.json Example

```json
{
  "provider": "claude",
  "provider_options": {
    "model": "claude-3-5-sonnet"
  },
  "features": ["architecture", "debugging", "code-generation"],
  "notifications": {
    "enabled": true,
    "style": "peon-ping"
  }
}
```

## Workflow Patterns

### Session Tracking

1. Start work session
2. Create/update `progress/[YYYY-MM-DD]-[slug].md`
3. Document what you accomplished
4. Commit to git

### Project Export (NotebookLM)

1. Run: `npm run export-project -- --project my-project`
2. Upload export to NotebookLM
3. Ask architectural questions
4. Get insights for implementation

### Provider Switching

1. Update `.agent/config.json`
2. Change `"provider"` field
3. Run corresponding setup script if first time
4. Continue using same workflow

## Integration Points

### External Tools

- **Todoist** - Task management (via `setup:todoist`)
- **GitHub CLI** - Code management (via `setup:github`)
- **Azure DevOps CLI** - Team collaboration (via `setup:azure-devops`)
- **Jira CLI** - Enterprise tracking (via `setup:jira`)
- **NotebookLM** - Architectural analysis (via `export-project`)

### AI Providers

- **Claude Code** - Interactive coding, planning, debugging
- **Kilocode CLI** - Terminal-first, multiple modes (Architect, Ask, Debug)
- **GitHub Copilot** - IDE integration, pair programming
- **QWEN** - LLM-based coding
- **Gemini** - Google's generative AI
- **Custom** - Any other AI agent

## Extensibility

### Add a New Provider

1. Create `agents/[provider-name].md` with setup instructions
2. Create `scripts/setup:[provider-name]` script
3. Update `scripts/create-project.sh` to include new provider option
4. Update `README.md` and docs/provider-selection.md

### Add a New Integration

1. Create `scripts/setup:[integration-name]` script
2. Document in `docs/integration-[name].md`
3. Add to npm scripts in `package.json`
4. Update SETUP.md

## Data Flow

```
User
  ↓
chose AI provider (Claude, Kilo, Copilot, etc.)
  ↓
Project (.agent/config.json specifies provider)
  ↓
AI Agent + Integrations (Todoist, GitHub, Jira, etc.)
  ↓
Output (code, notes, decisions, progress tracking)
  ↓
Export (NotebookLM for analysis)
  ↓
Git commit
```

## Configuration Hierarchy

1. **Global** - `~/.config/[provider]/` for user credentials
2. **Project** - `my-project/.agent/config.json` for provider selection
3. **Session** - `my-project/progress/[date]-slug.md` for session notes

Users typically configure:
- Global: Once when setting up provider (credentials)
- Project: Once when creating project (which provider)
- Session: Daily when tracking work

---

See [docs/](./docs/) for guides on specific workflows.
