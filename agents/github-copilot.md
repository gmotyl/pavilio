# GitHub Copilot Setup Guide

GitHub Copilot is an AI pair programmer integrated into your IDE.

## Prerequisites

- GitHub account with Copilot subscription
- Supported IDE: VS Code, JetBrains, Visual Studio, Neovim, etc.

## Installation

### VS Code

1. Install extension: "GitHub Copilot" (by GitHub)
2. Sign in with GitHub account
3. Authorize the extension
4. You're ready to use!

### JetBrains

1. Install plugin: "GitHub Copilot" (Jetbrains marketplace)
2. Go to Settings → Tools → GitHub Copilot
3. Click "Get Started" and authorize
4. Accept terms

### Other IDEs

See: https://github.com/features/copilot

## Features

- **Inline suggestions:** Real-time code completions
- **Chat:** Ask questions about your code
- **Documentation:** Generate comments and docstrings
- **Tests:** Generate test cases
- **Refactoring:** Suggest improvements

## Configuration

### Project-Specific Instructions

Create `.copilot/instructions.md` in your project:

```markdown
# Copilot Instructions for my-project

## Code Style

- Use TypeScript
- Prefer functional components
- Use const by default

## Architecture

- Component structure: src/components/
- Utilities: src/utils/
- Tests: __tests__/

## Conventions

- PascalCase for components
- camelCase for functions
- kebab-case for files

## Important Notes

- Always handle errors
- Write tests for new features
```

## Using Copilot with pavilio

1. Create project: `npm run create-project`
2. Choose "copilot" as provider
3. Create `.copilot/instructions.md` with your guidelines
4. Add to `.agent/config.json`:

```json
{
  "provider": "copilot",
  "provider_options": {
    "model": "gpt-4"
  },
  "features": ["inline-suggestions", "chat", "documentation"],
  "notifications": {
    "enabled": true,
    "style": "ide"
  }
}
```

5. Start coding in your IDE with Copilot enabled

## Tips

- Press Ctrl/Cmd+Enter to accept suggestions
- Use Chat (Ctrl/Cmd+I) for longer interactions
- Provide context with clear variable names
- Update instructions as project evolves
- Use for pair programming sessions

## Keyboard Shortcuts

| Action | VS Code | JetBrains |
|--------|---------|-----------|
| Accept suggestion | Tab | Tab |
| Next suggestion | Alt/Opt+] | Alt/Opt+] |
| Previous suggestion | Alt/Opt+[ | Alt/Opt+[ |
| Chat | Ctrl/Cmd+I | Ctrl/Cmd+I |

## Documentation

- https://github.com/features/copilot
- https://docs.github.com/copilot

## Troubleshooting

**"Copilot not showing suggestions"**
- Ensure extension is enabled
- Check GitHub Copilot subscription is active
- Sign out and back in

**"Can't authorize"**
- Check internet connection
- Verify GitHub account has Copilot access
- Try in browser first

**"Suggestions are slow"**
- This is normal during cold start
- Improve project structure and naming

---

See main README for switching between providers.
