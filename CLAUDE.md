# Claude Code Configuration

## Instructions for Every Session

**IMPORTANT: Start every conversation by reading AGENTS.md**

At the beginning of each session:

1. Read `AGENTS.md` to understand:
   - Project registry and their tracking
   - Session tracking rules and commands
   - Available commands
   - Code style guidelines

2. If the user says "resume [project]" or "resume":
   - Look up the most recent progress file in `notes/[project]/progress/`
   - Display the appropriate formatted response
   - Never skip this - it's how work continuity is maintained

3. If the user says "session end" or "end session":
   - Create/update `notes/[project]/progress/[date]-slug.md`
   - Commit and push to remote if configured
   - Start a new session automatically

4. Follow all project knowledge and commands documented in AGENTS.md

## Quick Reference

**First Time Setup:**
- Run `/model` to select your preferred Claude model
- (No hardcoded model—you choose which one to use)

**Resume Usage:** `resume [project-name]` → Get project context

**Built-in Claude Code Skills:**
- `/pavilio-memo` - Quick note capture
- `/pavilio-note` - Save session notes (project-aware! checks AGENTS.md first)
- `/pavilio-question` - Query project knowledge
- `/pavilio-bootstrap` - Initialize PROJECT.md structure

**Project-Aware Note Creation:**
- `/pavilio-note my-app` - Creates note in my-app project directory (from AGENTS.md)
- `/pavilio-note my-project` - Creates note in my-project project directory
- `/pavilio-note my-topic` - Creates generic note if topic not in AGENTS.md
- Auto-initializes directory structure if needed

**Quill Integration:**
- `/pavilio-note [project-name]` - If project exists in AGENTS.md, creates note there
- `/pavilio-note [meeting-name]` - Searches Quill for meetings, creates notes from minutes
- Extract meeting context, decisions, and action items
- Link notes back to Quill meeting IDs

**Model Selection:**
- `/model` - Select your Claude model (Opus, Sonnet, Haiku, etc.)
- Choose based on your needs and access level

**Local skills** live under [`skills/`](skills/), each in its own folder with a `SKILL.md`. The self-contained **pavilio-** family covers the workflow: `pavilio-session-start` / `pavilio-session-end` (session bracket), `pavilio-grill` (design), `pavilio-writing-plans` (plan), plus `pavilio-handoff` / `pavilio-compact` / `pavilio-resume`, `pavilio-manager`, `pavilio-audit`, `pavilio-qa-agent`, `pavilio-create-skill`, and the notes tools `pavilio-memo` / `pavilio-memo-explain` / `pavilio-note` / `pavilio-note-batch` / `pavilio-question` / `pavilio-bootstrap`. Other project skills: `pavilio-mermaid-chart`.

**Session Tracking:** Active - write "session end" to finalize

## Folder Structure

```
notes/
  [project]/
    /notes - session notes, decisions
    /progress - session tracking files
      [date]-slug.md
    PROJECT.md - project overview
    DECISIONS.md - key architectural decisions
.agent/
  config.json - provider configuration
```

## How to Add New Projects

Use the project creation script:

```bash
./scripts/create-project.sh
```

This will:
1. Ask for project name, type, and provider
2. Create directory structure
3. Generate PROJECT.md and DECISIONS.md
4. Update AGENTS.md registry (optional)
5. Create CLAUDE.md configuration for the project

---

**Configuration file for:** Claude Code sessions
**Location:** Repository root
**Auto-loaded:** Before each Claude Code session
