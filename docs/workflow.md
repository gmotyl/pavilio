# Day-to-Day Workflow

How to use pavilio in your daily work.

## Daily Routine

### 1. Start Your Day

```bash
# Navigate to your project
cd my-awesome-project

# Check progress from previous sessions
cat progress/
```

### 2. Plan Your Work

Use your configured AI provider to plan:

```bash
# Claude Code
claude-code  # Start interactive planning

# Kilocode CLI
kilo architect "What are the main tasks for today?"

# GitHub Copilot
# Start your IDE and use Chat (Ctrl/Cmd+I)
```

### 3. Work on Tasks

```bash
# Use your provider for implementation
# Update progress as you go
```

### 4. Track Progress

Create a session note:

```bash
# Create progress/YYYY-MM-DD-slug.md
cat > progress/2026-02-20-morning-session.md << 'EOFPROG'
# Session: 2026-02-20 - Morning Implementation

**Context:** Implementing authentication feature
**Time spent:** 2 hours

## What was done

- Implemented login API endpoint
- Added JWT token validation
- Created auth middleware

## Code changes

- `src/api/auth.ts:1-50` - Login endpoint
- `src/middleware/auth.ts` - Validation logic
- `tests/auth.test.ts:1-40` - Tests

## Notes

- Need to handle token refresh
- Should add rate limiting

## Next session

- Add token refresh logic
- Implement rate limiting
- Write documentation

EOFPROG
```

### 5. End of Day

```bash
# Commit your work
git add .
git commit -m "feat: implement authentication"

# Review tomorrow's priorities
kilo ask "What should we prioritize tomorrow?"
```

## Session Tracking

Each work session should be tracked in `progress/`:

**Naming:** `YYYY-MM-DD-slug.md`
- `2026-02-20-morning-session.md`
- `2026-02-20-afternoon-debugging.md`
- `2026-02-21-sprint-planning.md`

**Content:**
- Context: What was the goal?
- Time spent: How long did you work?
- What was done: List accomplishments
- Code changes: Which files were modified?
- Notes: Important discoveries or blockers
- Next session: What's next?

## Using Integrations

### Todoist

```bash
# Track tasks in Todoist
npm run setup:todoist  # First time setup

# Then use Todoist for daily task management
# Reference tasks from progress notes
```

### GitHub

```bash
# Push your work
git push

# Check for open issues
npm run setup:github  # First time setup
```

### NotebookLM Analysis

```bash
# When you need architectural insights
npm run export-project -- --project .

# Go to https://notebooklm.google.com/
# Create notebook, paste content
# Ask: "What's the architecture?"
#      "How should we refactor X?"
#      "What's missing?"
```

## Context & Git Integration

### Update .claude/commands/ (if using Claude)

```bash
mkdir -p .claude/commands

# Create custom commands for your project
cat > .claude/commands/resume-project.md << 'EOFCMD'
# Resume Project

Show me:
1. Latest progress note
2. Open decisions from DECISIONS.md
3. Next session priorities

Then: "What should I focus on first?"
EOFCMD
```

### References in Notes

Link to relevant files in your notes:

```markdown
# Session: 2026-02-20

## Related Files
- `src/components/Auth.tsx` - Login UI
- `docs/ARCHITECTURE.md` - System design
- `DECISIONS.md` - API design decision
```

## Switching Providers Mid-Project

If you need to switch providers:

```bash
# 1. Update config
cd my-project
# Edit .agent/config.json
# { "provider": "kilocode" } → { "provider": "claude" }

# 2. Setup new provider (first time)
npm run setup:claude-code

# 3. Continue working
# Progress notes stay the same
# Folder structure unchanged
# Just use different AI agent
```

## Weekly Review

```bash
# Export your project for analysis
npm run export-project -- --project .

# Upload to NotebookLM and ask:
# "Summarize this week's progress"
# "What decisions were made?"
# "What's the current architecture?"
```

## Tips

- **Consistent naming:** Always use YYYY-MM-DD-slug format
- **Regular commits:** Commit after each logical chunk
- **Session notes matter:** They help you resume faster
- **Use provider strengths:** Claude for architecture, Kilo for quick answers, Copilot for typing
- **Document decisions:** DECISIONS.md is your project history
- **Export regularly:** Use NotebookLM for big picture analysis

---

Need help? Check [README.md](../README.md) or [provider-selection.md](./provider-selection.md)
