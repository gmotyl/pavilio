# AGENTS.md - Projects Workspace

This file defines your project registry and workflow for AI agents (Claude Code, Kilocode, Copilot, etc.).

## Projects Registry

| Project | Type | Provider | Notes Path | Repos/Resources |
|---------|------|----------|-----------|-----------------|
| ch | work | claude | `notes/ch/` | [Add repository path] |
| my-app | work | claude | `notes/my-app/` | git/my-app, git/my-app-backend |
| my-project | personal | kilocode | `notes/my-project/` | github.com/username/my-project |
| example-app | freelance | copilot | `notes/example-app/` | gitlab.com/client/example-app |
| landingpage | work | claude | `notes/landingpage/` | http://fakeurl.com/landingpage.git |

### Adding More Projects

To add your projects:
1. Add a new row to the table above with your project details
2. When you use `/note [project-name]`, Claude Code will lookup the project and use its notes path
3. Remove example projects when you add your own

## Provider Configuration

Each provider has its own configuration file location and format. When you create a project, the appropriate files are generated automatically.

| Provider | Config File(s) | Location | Session Tracking |
|----------|-----------------|----------|-----------------|
| **Claude Code** | `CLAUDE.md` + `.claude/settings.json` | Project root | ✅ Auto (session end) |
| **Kilocode** | `opencode.json` | Project root | ✅ Auto (session end) |
| **GitHub Copilot** | `.github/copilot-instructions.md` | Project .github/ | ⚠️ Manual |
| **QWEN** | `.qwen/settings.json` | Project `.qwen/` | ⚠️ Manual |
| **Google Gemini** | `.gemini/settings.json` | Project `.gemini/` | ⚠️ Manual |

**Important:**
- Each provider expects its config files in **specific locations** (see `docs/PROVIDER-SETUP.md`)
- Claude Code is the only provider with automatic session tracking
- Other providers require manual progress saving or custom scripts
- Global settings: `~/.claude/`, `~/.config/kilo/`, `~/.copilot/`, `~/.qwen/`, `~/.gemini/`

**Setup Guide:**
See `docs/PROVIDER-SETUP.md` for:
1. CORRECT file locations for each provider
2. Configuration file formats and examples
3. Global vs project-level configuration
4. Session tracking setup for each provider
5. Switching providers mid-project

## Project-Specific Rules

### Default Behavior (All Projects)

**Commits:**
- After milestone reached ask whether to commit (Not automatic)
- Prevent accumulation of uncommitted changes while respecting user control

**Planning Mode:**
- Agent enters planning mode after every session resume
- Use brainstorming skill for design review
- Provide architecture clarity before implementation

**To override:** Add project-specific row below the default rules.

## Session Tracking

Session tracking is active. All messages are part of a single session until you write "session end" or "end session".

### Session End

When you write "session end" or "end session":

1. Create new `notes/[project]/progress/[date]-slug.md` (always create fresh file)
2. Progress file content:
   - Context of tasks completed in this session
   - Results/outcomes achieved
   - Next steps or blockers discovered
   - Useful context for resuming work
3. Commit and push to remote if configured
4. Propose Todoist tasks if something is left to do (format: `[project-name] Task description`)
5. Clear context and start a new session automatically

### Resume Session

Usage: `resume [project-name]` or just `resume`

Load recent context:

1. Load most recent progress file from `notes/[project]/progress/`
2. Read PROJECT.md to get repository locations and key context
3. Display brief formatted resume with last session context

## Commands

Commands in `commands/` folder (if created). Use `/command` syntax:

- `/memo` - Quick capture a thought or note
- `/note` - Process meeting transcripts or session notes
- `/question` or `/q` - Query project knowledge base
- `/bootstrap` - Initialize PROJECT.md and _index.json
- `/resume` - Quick session resume (progress + PROJECT.md only)

## Commands & Skills

### Claude Code Built-in Skills
Claude Code provides these as native slash commands:
- `/memo` - Quick capture a thought or note
- `/note` - Process meeting transcripts or session notes
  - **Quill Integration:** `/note meeting-name` searches Quill for meetings, creates notes from minutes
- `/question` or `/q` - Query project knowledge base
- `/bootstrap` - Initialize PROJECT.md and project structure

### Smart Project Initialization
The `/note` command auto-initializes projects:
- `/note my-project` → Found in AGENTS.md → Creates note in `notes/my-project/notes/`
- `/note new-project` → NOT in AGENTS.md → **Asks: "Initialize project?"**
  - If yes: Creates full structure + configs + adds to AGENTS.md
  - If no: Creates generic note in `notes/notes/`

### Quill Integration
The `/note` command integrates with Quill meeting notes:
- Search for meetings by name: `/note my-project` finds "my-project" meetings in Quill
- Extract meeting minutes and create project notes in `notes/my-project/notes/`
- Preserve meeting context and action items
- Link notes back to original Quill meetings
- Works with both registered projects and newly initialized ones

### Fallback Command Scripts
If built-in skills aren't available, use executable scripts in `commands/` folder:
```bash
./commands/memo.sh "Your quick thought"
./commands/note.sh session-topic
./commands/question.sh "What is X?"
./commands/bootstrap.sh
```

See `commands/README.md` for detailed usage and examples.

---

## Code Style Guidelines

### TypeScript/JavaScript

- Use TypeScript when possible
- Explicit types for function parameters and return values
- Use `const` by default, `let` only when reassignment needed
- Prefer `async/await` over raw promises
- Use optional chaining: `obj?.prop` and nullish coalescing: `??`

### Error Handling

- Always handle promise rejections
- Use `try/catch` with meaningful error messages
- Propagate errors up with context: `throw new Error(\`Failed to X: ${err.message}\`)`

### Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Variables/Functions | camelCase | `getUserData`, `isValid` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_RETRIES` |
| Classes | PascalCase | `UserService` |
| Files | kebab-case | `user-service.ts` |

---

**Generated by:** motyl-ai-workflow template
**Last updated:** Use `scripts/register-project.sh` to add new projects
