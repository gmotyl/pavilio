# Example Work Project

**Type:** Work / Client Project
**Provider:** (Your choice - e.g., Claude Code)
**Created:** 2026-02-20
**Team:** Example Team

## Overview

This is an example work project showing how to use pavilio for professional/team projects.

Work projects typically:
- Have team collaboration requirements
- Use company-sponsored tools
- Require more formal tracking
- Integrate with JIRA, GitHub, Azure DevOps

## Folder Structure

- `notes/` - Meeting notes, decision logs, discussions
- `progress/` - Session tracking, standups
- `.agent/` - AI provider configuration
- `PROJECT.md` - This file
- `DECISIONS.md` - Architectural decisions

## Provider Configuration

Different teams/companies sponsor different tools. Choose what your company uses:
- Claude Code (popular for enterprise)
- GitHub Copilot (GitHub-integrated)
- Kilocode (community/open-source)
- QWEN (alternative LLM)
- Gemini (Google's offering)

See `.agent/config.json` for configuration.

## Integrations

This project can integrate with:
- **Todoist** - Task management
- **GitHub** - Code repository
- **Azure DevOps** - Team collaboration (if your company uses it)
- **Jira** - Enterprise tracking

Setup via: `npm run setup:[integration]`

---

You can delete this example after reviewing, or use it as a template for your first work project.
