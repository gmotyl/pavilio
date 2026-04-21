# Example projects

The three folders here (`my-work`, `my-pet-project`, `my-blog`) are **examples** shipped with Pavilio so the dashboard has something to show on first run. Each one has a `PROJECT.md` (required for discovery) and a single note describing a part of the system:

| Project | Note | Topic |
|---|---|---|
| `my-work` | `notes/architecture.md` | How the panel is wired up |
| `my-pet-project` | `notes/mobile-access.md` | Using the panel from your phone |
| `my-blog` | `notes/memo-system.md` | `/memo`, `/note`, `/question` commands |

Read them once, then replace them with your own.

## Start your own

```bash
# From the repo root:
rm -rf projects/my-work projects/my-pet-project projects/my-blog

mkdir -p projects/my-project
cat > projects/my-project/PROJECT.md <<'EOF'
# My Project

## Overview

One or two sentences about what this project is.
EOF
```

The panel auto-discovers the new folder on the next polling cycle — no restart needed. Add `notes/`, `plans/`, and `progress/` subfolders as you go; all are optional.

If you want to keep this `projects/` folder out of git entirely (recommended for private work), point `projectsDir` elsewhere in `panel/panel.config.local.ts`:

```ts
// panel/panel.config.local.ts  (gitignored)
const local: Partial<PanelConfig> = {
  projectsDir: "/absolute/path/to/your/projects",
};
export default local;
```
