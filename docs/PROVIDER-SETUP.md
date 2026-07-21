# AI Provider Setup Guide

Each AI provider has its own configuration location and format. This guide shows the CORRECT setup for each provider.

## Quick Reference

| Provider | Config Location | Format | Project-Level? | Global Config? |
|----------|-----------------|--------|-----------------|-----------------|
| **Claude Code** | `CLAUDE.md` + `.claude/settings.json` | Markdown + JSON | ✅ Yes | `~/.claude/` |
| **GitHub Copilot** | `~/.copilot/config.json` | JSON | ❌ Global only | ✅ Required |
| **Kilocode** | `opencode.json` | JSON/JSONC | ✅ Yes | `~/.config/kilo/` |
| **Qwen Code** | `.qwen/settings.json` | JSON | ✅ Yes | `~/.qwen/` |
| **Google Gemini** | `.gemini/settings.json` | JSON | ✅ Yes | `~/.gemini/` |

---

## 1. Claude Code Setup

### Configuration Files

**Project-level (committed to git):**
- `CLAUDE.md` - Instructions and context for Claude (what Claude should know)
- `.claude/settings.json` - Technical settings (optional, for team-wide settings)

**User-level (in home directory):**
- `~/.claude/settings.json` - Your personal Claude Code settings
- `~/.claude/CLAUDE.md` - Your global memory/instructions

### CLAUDE.md (Project Memory)

```markdown
# Project Context

## Project Overview
[Describe your project]

## Setup Instructions

1. Install dependencies
2. Configure environment
3. Run development server

## Key Commands

- `resume` - Load last session context
- `session end` - Save progress
- `/pavilio-memo` - Quick note capture
- `/pavilio-note` - Process meeting transcripts

## Important Context

### Architecture
[Document architecture decisions]

### Key Files
[List important files and their purpose]

### Team Guidelines
[Team-specific guidelines]
```

### `.claude/settings.json` (Technical Settings)

**Note:** Do NOT hardcode a model. Run `/model` to select your preferred Claude model on first use.

```json
{
  "temperature": 0.7,
  "max_tokens": 4096,
  "tools": {
    "browser": true,
    "file_system": true,
    "bash": true
  },
  "session_tracking": true,
  "session_directory": "progress/",
  "auto_memory": true
}
```

### Session Tracking

Claude Code automatically:
- Reads `CLAUDE.md` at session start
- Creates `progress/[date]-slug.md` on `session end`
- Loads last progress file on `resume [project]`

---

## 2. GitHub Copilot CLI Setup

### Configuration

Copilot uses **global user settings only** (no project-level config):

```bash
# Interactive setup
github-copilot-cli auth login
github-copilot-cli config set model gpt-4
github-copilot-cli config set timeout 300
```

**Config stored at:** `~/.copilot/config.json`

```json
{
  "model": "gpt-4",
  "timeout": 300,
  "max_tokens": 2048,
  "api_endpoint": "https://api.github.com/copilot",
  "temperature": 0.7
}
```

### Project Setup

Copilot doesn't have project-level config, but you can:

1. **Create `.github/copilot-instructions.md`** (GitHub-specific, for web UI and future features)
   ```markdown
   # Project Guidelines for GitHub Copilot

   ## Project Context
   [Your project description]

   ## Code Style
   [Your code style guidelines]
   ```

2. **Store instructions in IDE settings** (if using IDE integration)

3. **Use workspace instructions** in IDE workspace file (`.code-workspace` for VS Code)

### Session Tracking

Since Copilot doesn't track sessions automatically:

```bash
# Start working in your project
cd [project]

# Before ending, manually save progress
cat > progress/$(date +%Y-%m-%d)-session.md << EOF
# Session Notes

## Accomplishments
- [What was done]

## Next Steps
- [What's next]
EOF
```

---

## 3. Kilocode CLI Setup

### Configuration Files

**Project-level:**
```bash
opencode.json                    # Primary config file
```

**User-level:**
```bash
~/.config/kilo/opencode.json     # Global user settings
```

### `opencode.json` Format

```json
{
  "provider": "kilo",
  "model": "kilocode-latest",
  "context": {
    "max_tokens": 8000,
    "include_git_history": true
  },
  "permissions": {
    "file_system": "read-write",
    "bash_commands": true,
    "git_operations": true
  },
  "mcp_servers": [
    {
      "name": "filesystem",
      "command": "mcp-server-filesystem"
    }
  ],
  "behavior": {
    "auto_save_sessions": true,
    "session_directory": "progress/",
    "temperature": 0.7
  }
}
```

### Session Tracking

```bash
# Start session
cd [project]
kilocode resume

# Kilocode auto-saves sessions to: progress/[date]-slug.md

# End session
# Type: session end
```

### Using `.opencode/` Directory (Alternative)

Instead of `opencode.json`, you can use a directory:

```bash
.opencode/
├── config.json
├── mcp-servers.json
├── credentials.json  # Gitignored
└── team-settings.json
```

---

## 4. Qwen Code Setup

### Configuration Files

**Project-level:**
```bash
.qwen/settings.json
```

**User-level:**
```bash
~/.qwen/settings.json
```

**System-level (optional):**
```bash
/etc/qwen-code/settings.json     # Linux/macOS
C:\ProgramData\qwen-code\settings.json  # Windows
```

### `.qwen/settings.json` Format

```json
{
  "general": {
    "project_name": "my-project",
    "project_type": "web",
    "team": "solo"
  },
  "model": {
    "provider": "qwen",
    "model_name": "qwen-plus",
    "temperature": 0.7,
    "max_tokens": 2048,
    "api_endpoint": "https://dashscope-intl.aliyun.com/api/v1"
  },
  "context": {
    "include_git_history": true,
    "max_context_files": 10,
    "auto_load_docs": true
  },
  "tools": {
    "bash": true,
    "file_system": true,
    "git": true
  },
  "session": {
    "auto_save": true,
    "session_directory": "progress/",
    "context_memory": true
  }
}
```

### Environment Variables

```bash
export DASHSCOPE_API_KEY="your-api-key"
export QWEN_PROJECT_ROOT="$(pwd)"
export QWEN_LOG_LEVEL="info"
```

### Session Tracking

```bash
# Qwen can load context from progress files
cd [project]

# Start interactive session
qwen-cli --interactive

# In CLI, reference last session:
# > Resume from progress/2026-02-20-session.md
# > [your prompt]

# Save manually:
cat > progress/$(date +%Y-%m-%d)-session.md << EOF
# Session Summary
[Save your session notes]
EOF
```

---

## 5. Google Gemini Setup

### Configuration Files

**Project-level:**
```bash
.gemini/settings.json
```

**User-level:**
```bash
~/.gemini/settings.json
```

**System-level (optional):**
```bash
/etc/gemini-cli/settings.json    # Linux/macOS
C:\ProgramData\gemini-cli\settings.json  # Windows
```

### `.gemini/settings.json` Format

```json
{
  "general": {
    "project_name": "my-project",
    "project_root": ".",
    "team": "solo"
  },
  "model": {
    "provider": "google",
    "model_name": "gemini-pro",
    "temperature": 0.7,
    "max_tokens": 2048,
    "api_endpoint": "https://generativelanguage.googleapis.com/v1beta/models"
  },
  "features": {
    "vision": true,
    "document_analysis": true,
    "code_understanding": true
  },
  "context": {
    "include_git_history": true,
    "max_context_size": 10000,
    "auto_summarize": true
  },
  "tools": {
    "bash": true,
    "file_system": true,
    "git": true
  },
  "session": {
    "auto_save": true,
    "session_directory": "progress/",
    "context_memory": true
  }
}
```

### API Setup

```bash
# Get API key from: https://aistudio.google.com
export GEMINI_API_KEY="your-api-key"

# Set up project
gemini-cli init
gemini-cli config set model gemini-pro
gemini-cli config set project-root "$(pwd)"
```

### Session Tracking

```bash
# Python example
import google.generativeai as genai

genai.configure(api_key=os.environ["GEMINI_API_KEY"])
model = genai.GenerativeModel("gemini-pro")

# Load context from progress file
with open("progress/2026-02-20-session.md") as f:
    context = f.read()

# Use in chat
chat = model.start_chat()
response = chat.send_message(f"Resume from:\n{context}\n\nContinue...")

# Save progress
with open(f"progress/{date}-session.md", "w") as f:
    f.write(response.text)
```

---

## Creating a New Project

### Step 1: Run Project Creation

```bash
./scripts/create-project.sh
```

### Step 2: Choose Your Provider

The script will generate the appropriate configuration files:

**For Claude Code:**
```
my-project/
├── CLAUDE.md
├── .claude/
│   └── settings.json
├── progress/
└── notes/
```

**For Kilocode:**
```
my-project/
├── opencode.json
├── progress/
└── notes/
```

**For Qwen:**
```
my-project/
├── .qwen/
│   └── settings.json
├── progress/
└── notes/
```

**For Gemini:**
```
my-project/
├── .gemini/
│   └── settings.json
├── progress/
└── notes/
```

**For Copilot:** (User global only, just docs)
```
my-project/
├── .github/
│   └── copilot-instructions.md
├── progress/
└── notes/
```

### Step 3: Complete Setup

1. **Update project README** with your description
2. **Set global provider settings** (if needed)
3. **Configure API keys** in environment variables
4. **Start working** with your chosen provider

---

## Switching Providers Mid-Project

### From Claude to Kilocode

1. **Keep existing:** `CLAUDE.md` (for team reference), `progress/` (session history)
2. **Update:** `.claude/settings.json` (change provider to "kilocode")
3. **Add:** `opencode.json` with Kilocode configuration
4. **Commit:** Changes to git

```bash
# Create opencode.json
cat > opencode.json << EOF
{
  "provider": "kilo",
  "model": "kilocode-latest",
  "context": {
    "max_tokens": 8000,
    "include_git_history": true
  }
}
EOF

# Update .claude/settings.json
# Change: "provider": "kilocode"

git add opencode.json .claude/settings.json
git commit -m "feat: add Kilocode support alongside Claude Code"
```

---

## Verification Checklist

- [ ] Global provider settings configured (`~/.copilot/`, `~/.config/kilo/`, etc.)
- [ ] API keys set in environment variables
- [ ] Project-level config files created (if provider supports it)
- [ ] `progress/` directory created
- [ ] `CLAUDE.md` or provider docs exist (if applicable)
- [ ] Provider CLI can access project: `cd [project] && [provider-cli] --version`
- [ ] Test session tracking works

---

## Troubleshooting

**Provider CLI not found:**
```bash
# Run setup script
npm run setup:[provider]

# Or install manually
# Claude: npm install -g @anthropic-sdk/claude-code
# Kilocode: npm install -g kilocode-cli
# Copilot: brew install gh && gh extension install github/gh-copilot
```

**Config not loading:**
1. Check file is in correct location
2. Verify JSON syntax: `jq . .qwen/settings.json`
3. Restart provider CLI
4. Check environment variables: `env | grep API_KEY`

**Session tracking not working:**
1. Verify `progress/` directory exists and is writable
2. Check file permissions: `ls -la progress/`
3. Run provider CLI from project root

---

## Sources & Documentation

- [Claude Code Settings - Official Docs](https://code.claude.com/docs/en/settings)
- [GitHub Copilot CLI - GitHub Docs](https://docs.github.com/en/copilot/how-tos/copilot-cli)
- [Kilocode CLI - Official Docs](https://kilo.ai/docs/cli)
- [Qwen Code Configuration - Qwen Docs](https://qwenlm.github.io/qwen-code-docs)
- [Google Gemini CLI - Gemini Docs](https://google-gemini.github.io/gemini-cli)
