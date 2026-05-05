# Projects Panel Guide

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+P` | Open Quick Finder (file search) |
| `?` prefix in Quick Finder | Semantic search (QMD knowledge query) |
| `Cmd+Enter` in Quick Finder | Open file in VS Code |
| `↑` / `↓` | Navigate Quick Finder results |
| `Enter` | Open selected file |
| `Esc` | Close Quick Finder / current modal |
| `Cmd+U` (Mac) / `Ctrl+U` (Windows/Linux) | Open Terminal Viewport Reader for the focused terminal (toggle) |

## Navigation

- **Breadcrumbs** — top bar shows your current location, each segment is clickable
- **Home icon** — click to return to dashboard
- **Left sidebar** — projects list, active agents, git summary
- **Right sidebar** — file tree for current project, commands list
- **Sidebar toggles** — collapse/expand buttons on sidebar edges

## Features

### Quick Finder (Cmd+P)
Fuzzy file search across all projects. Type to filter, arrow keys to navigate, Enter to open. Files show project badge and last modified date.

### Semantic Search
In Quick Finder, type `?` followed by your query to search project knowledge using QMD. Returns ranked results with context snippets.

### Project View
Click a project in the left sidebar to see its PROJECT.md, decisions, plans, and notes. Use the section tabs to navigate.

### Markdown Viewer
All `.md` files render with GitHub-flavored markdown. Relative links resolve within the panel. Drag-and-drop images onto markdown files to optimize and embed them.

### Git Panel
View git status across all project repositories. Stage changes, view diffs, and commit from the panel.

### Agent Monitoring
Active Claude Code and other AI agents appear in the left sidebar with their status, PID, and working project.

### Favorites
Star projects in the left sidebar to pin them to the top of the list. Persisted in localStorage.

### Commands
Right sidebar lists all available `/commands` with descriptions. Click to view the command's markdown source.

### Image Optimization
Drag and drop images onto the markdown viewer to optimize them with sharp and embed the reference.

### Terminal Viewport Reader
xterm renders to a canvas, so the browser's "Read Aloud" / screen-reader / find-in-page features can't see anything. Each terminal cell has an Eye icon in its header (between the title and the Maximize button) that opens a modal with a plain-DOM, fully styled snapshot of what's currently on screen.

**Open it with:**
- The Eye icon on the cell header, or
- `Cmd+U` / `Ctrl+U` while the terminal is focused.

**Inside the modal:**
- Width matches the terminal width and the font matches xterm's, so wrapping is the same as on the live terminal.
- ANSI colors, bold, italic, underline, dim, inverse, and strike-through are preserved.
- The first page shows the current viewport. A full-width **"Load previous page"** button at the top prepends the previous `rows` lines from scrollback — keep clicking to walk further back, up to the start of the buffer.
- **Print** button opens a new tab with the loaded text and triggers `window.print()`.
- Right-click the text and pick **Read aloud** in Edge (or use your screen reader / find-in-page).

**Close it with:**
- `Esc`,
- `Cmd+U` / `Ctrl+U` (toggles), or
- click the backdrop / the × in the header.

The snapshot is frozen at the moment you open the modal — output that streams afterward in the live terminal does not shift indices in the modal.
