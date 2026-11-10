# NotebookLM Integration Guide

Use Google NotebookLM with your projects for architectural analysis and planning.

## What is NotebookLM?

NotebookLM is an AI notebook that lets you:
- Upload your project structure and notes
- Ask questions about your architecture
- Get insights and recommendations
- Prepare implementation plans
- Analyze design decisions

Visit: https://notebooklm.google.com/

## Quick Start

### 1. Export Your Project

```bash
npm run export-project -- --project my-project
# Creates: my-project/exports/export-YYYYMMDD-HHMMSS.md
```

### 2. Open NotebookLM

- Go to: https://notebooklm.google.com/
- Create new notebook
- Paste export file content

### 3. Ask Questions

```
"What's the current architecture?"
"How should we refactor the authentication system?"
"What are the key design decisions?"
"What's missing from the implementation?"
"Summarize the project structure"
```

## Detailed Workflow

### Export Format

The export includes:
- `PROJECT.md` - Project overview
- `DECISIONS.md` - Architectural decisions
- Recent `progress/` session notes

Example export file:
```markdown
# Project Export for NotebookLM

## PROJECT.md
[Your project overview]

## DECISIONS.md
[Key decisions]

## Agent Configuration
```json
{...}
```

## Recent Session Notes
[Latest progress notes]
```

### Using NotebookLM

**Step 1:** Create notebook
- Go to https://notebooklm.google.com/
- Click "Create notebook"
- Paste your exported content

**Step 2:** Start querying
- "What's the data flow?"
- "How should we optimize X?"
- "What are the main challenges?"
- "Generate an implementation plan for X"

**Step 3:** Refine questions
- Ask follow-ups based on answers
- Get deeper insights
- Discover hidden dependencies

## Example Questions

### Architecture Understanding
- "What's the system architecture?"
- "How do the main components interact?"
- "What are the critical paths?"
- "Where are the bottlenecks?"

### Design Review
- "What assumptions are we making?"
- "Are there better alternatives for X?"
- "What edge cases are we missing?"
- "How scalable is the current design?"

### Implementation Planning
- "What should we implement next?"
- "What's the recommended order?"
- "What are the dependencies?"
- "What could go wrong?"

### Decision Analysis
- "Why was decision X made?"
- "What were the alternatives?"
- "Should we revisit decision X?"
- "What decisions need documentation?"

### Team Communication
- "Can you summarize this for a new team member?"
- "What should I prioritize this week?"
- "What have we accomplished?"
- "What are the blockers?"

## Workflow Integration

### Daily Use

```bash
# Morning: Review progress
npm run export-project -- --project .
# Upload to NotebookLM
# "What should I focus on today?"

# Evening: Planning
# "What should I work on tomorrow?"
```

### Weekly Planning

```bash
# Friday: Weekly review
npm run export-project -- --project .
# Upload to NotebookLM
# "Summarize this week's progress"
# "What's our status for next week?"
```

### Architecture Reviews

```bash
# Before refactoring
npm run export-project -- --project .
# Upload to NotebookLM
# "Should we refactor X?"
# "What's the best approach?"

# After refactoring
npm run export-project -- --project .
# Upload to new notebook
# "How is the new architecture?"
```

### Team Onboarding

```bash
# For new team member
npm run export-project -- --project .
# Share notebook with team member
# They can ask:
# "Explain the architecture"
# "What are the main responsibilities?"
# "Where should I start?"
```

## Tips

- **Regular exports:** Export weekly or before big changes
- **Keep project updated:** Better project docs = better insights
- **Ask specific questions:** More specific = better answers
- **Use follow-ups:** Ask follow-up questions to dive deeper
- **Share notebooks:** Great for team documentation
- **Archive old notebooks:** Keep latest for reference

## Example Session

```
You: "What's the project architecture?"

NotebookLM: "Your project has three main components:
1. API Layer - handles requests
2. Business Logic - processes data
3. Database - stores information
The flow is: API → Logic → Database"

You: "Should we add caching?"

NotebookLM: "Yes, caching would help because:
- Database queries are frequent
- Data doesn't change often
- Response times would improve
Consider: Redis for in-memory cache"

You: "Where should caching go?"

NotebookLM: "Best places:
1. Between API and Logic - cache API responses
2. Between Logic and Database - cache queries
Start with database query caching - easier to implement"
```

## Limitations

- Export includes only last N progress notes
- Large projects may need splitting
- Real-time collaboration not available
- Requires internet connection

## Pro Tips

- See [agents.md](./agents.md) for the supported agents
- See [architecture.md](./architecture.md) for how projects, notes and progress fit together
- Regular exports help catch gaps early
- Share notebooks for team alignment
- Keep notes well-structured for better analysis

---

Ready to export? `npm run export-project -- --project my-project`
