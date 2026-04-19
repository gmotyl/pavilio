# Complete Daily Workflow Example

Real-world example of using pavilio for a project called `landingpage`.

## First Time: Create & Initialize Project

```
❯ /note landingpage

⚠️  Project "landingpage" not found in AGENTS.md

❓ Would you like to initialize "landingpage" as a new project?

→ Yes

  1. Project type? → Work
  2. Provider? → Claude Code

✅ Project "landingpage" initialized!
   - Created: notes/landingpage/notes/, progress/, PROJECT.md
   - Registered in AGENTS.md
   - Ready for work

[Editor opens for note editing]
```

## Morning: Start Work Session

```
❯ resume landingpage

🚀 Resume: landingpage
  Status: Ready for Development
  Type: Work | Provider: Claude Code
  Last Session: 2026-02-20 - Project initialization

  What would you like to work on?
```

## During Session: Create Notes & Memos

```
❯ /note landingpage

✓ Found project in AGENTS.md
✓ Creating note in notes/landingpage/notes/

[Editor opens - add session notes, decisions, next steps]

❯ /memo "Fixed navbar layout issue, need to review responsive design"

✓ Memo saved to notes/landingpage/notes/[date]-memos.md
```

## End of Session: Save Progress

```
❯ session end

✓ Reading project context from PROJECT.md
✓ Reading AGENTS.md registry

Session Summary:
  Project: landingpage
  Time: ~2 hours of development
  Tasks: Navbar layout, responsive testing
  Next: CSS optimization

✓ Created: notes/landingpage/progress/2026-02-20-navbar-layout.md
✓ Committed to git (branch main)

Ready for next session!
```

## Later: Resume & Continue Work

```
❯ resume landingpage

🚀 Resume: landingpage
  Last Session (2026-02-20):
    - ✅ Navbar layout fixed
    - ⏳ Next: CSS optimization

  Session Notes:
    - Fixed responsive breakpoints
    - Need to review on mobile devices

  Ready to continue!

❯ /note landingpage

[Create today's session note]
[Document: Tested on iPhone, added media queries]

❯ session end

✓ Progress tracked: notes/landingpage/progress/2026-02-21-mobile-testing.md
✓ Session committed
```

## Next Morning: Daily Standup Prep

```
❯ standup landingpage

📊 Standup Report: landingpage

  ✅ What I did (yesterday):
    - Fixed navbar layout responsive design
    - Tested on multiple mobile devices
    - CSS optimization in progress

  🚀 What I'm doing (today):
    - Continue CSS optimization
    - Test on tablet sizes
    - Performance review

  🚧 Blockers:
    - None currently

  📝 Last 2 sessions:
    1. 2026-02-21 - Mobile testing (1.5h)
    2. 2026-02-20 - Navbar layout (2h)

  📋 Open tasks: [from Todoist if integrated]
```

## Command Reference

| Command | Purpose | Example |
|---------|---------|---------|
| `/note [project]` | Create session note (auto-initializes if needed) | `/note landingpage` |
| `/memo "text"` | Quick thought capture | `/memo "Fix navbar bug"` |
| `resume [project]` | Load project context + last session | `resume landingpage` |
| `session end` | Save progress + commit | `session end` |
| `standup [project]` | Daily standup preparation | `standup landingpage` |
| `/question` | Search project knowledge | `/question "How was navbar built?"` |

## Key Points

- **Automatic Session Tracking:** Each `session end` creates a progress file and commits automatically
- **Project Context:** Commands automatically detect which project you're working on
- **Quill Integration:** `/note meeting-name` searches for meetings and creates notes from minutes
- **No Manual File Management:** Everything is organized by the template structure
- **Resume Anywhere:** `resume [project]` loads context from your last session
