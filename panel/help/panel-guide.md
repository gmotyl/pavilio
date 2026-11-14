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
| `Alt+Shift+F` (`Option+Shift+F` on Mac) | Toggle the focus layout |
| `Alt+Shift+C` | Toggle cell fullscreen for the focused terminal cell |
| `Alt+Shift+T` | Toggle terminal fullscreen (the whole terminal container) |
| `Alt+Shift+O` | Toggle the focused cell's answer pane (same as the eye button at the end of its speech row; only while that row is shown) |

The `Alt+Shift` shortcuts work even while a terminal has focus — the terminal never sees them. The one exception is `Alt+Shift+O`: while the cell's speech row is hidden it is not bound, so the key passes through to the terminal. They are desktop-only (inactive in the phone layout).

## Navigation

- **Breadcrumbs** — top bar shows your current location, each segment is clickable
- **Home icon** — click to return to dashboard
- **Left sidebar** — projects list, active agents, git summary
- **Right sidebar** — file tree for current project, skills list
- **Sidebar toggles** — collapse/expand buttons on sidebar edges
- **Focus layout** — the focus toggle (or `Alt+Shift+F`) hides the breadcrumb row and the project title row on project pages (`/project/<name>` and its section tabs, except the time page) to give the page more room; page tabs, terminal strip and cells stay. Other pages keep both rows. The toggle sits in the breadcrumb row, and at the right end of the page-tab row while focus is on. Desktop only: on a phone both rows always show.

## Features

### Dashboard
Lists all discovered projects. A project is discovered when its folder contains a `PROJECT.md` file. Each card shows the project name, badges for the sections it has (notes, progress, plans, index), and the date of its latest progress entry.

### Quick Finder (Cmd+P)
Fuzzy file search across all projects. Press `Cmd+P` anywhere in the panel, type to filter, arrow keys to navigate, Enter to open. It searches filenames; files show project badge and last modified date. For semantic search across note content, use the `?` prefix (below) or `qmd` from the terminal.

### Semantic Search
In Quick Finder, type `?` followed by your query to search project knowledge using QMD. Returns ranked results with context snippets.

### Project View
Click a project in the left sidebar to see its PROJECT.md, decisions, plans, and notes. Use the section tabs to navigate.

The project's settings card has an **Answer panel opacity (bottom)** slider (0–100%, default 100%): it fades the bottom edge of that project's terminal answer panes, while their top edge stays solid.

### Markdown Viewer
All `.md` files render with GitHub-flavored markdown. Relative links resolve within the panel. The "Open in VS Code" button opens the file in VS Code. Drag-and-drop images onto markdown files to optimize and embed them.

### Git Panel
View git status across all project repositories. Stage changes, view diffs, write a commit message, commit and push — all from the browser.

### File Tree
The right sidebar shows a file tree with every project, the active one expanded. Click a file to open it. Drag a file onto a folder to move it; moves are limited to notes under `projects/`.

### Agent Monitoring
Active Claude Code and other AI agents appear in the left sidebar with their status, PID, and working project. Agents started through the `ccl` (Claude Code) and `oc` (opencode) wrappers register themselves in `~/.agent-registry.json`, which the panel polls; see [docs/agents.md](https://github.com/gmotyl/pavilio/blob/main/docs/agents.md) in the pavilio repository (sync-mode workspaces do not receive `docs/`).

### Favorites
Star projects in the left sidebar to pin them to the top of the list. Persisted in localStorage.

### Skills
Right sidebar lists all skills under `skills/` with descriptions parsed from each `SKILL.md` YAML frontmatter. Click to view the skill's source.

### Image Optimization
Drag and drop images onto the markdown viewer to optimize them with sharp and embed the reference.

### Terminal
Full terminal sessions (general-purpose shells) in the browser. Keyboard shortcuts differ from stock xterm.js so that copy and cancel never fire from the same chord on Windows:

| Chord | Action |
| --- | --- |
| `Ctrl+C` | Copies the selection. With nothing selected, sends the interrupt (`^C`) instead. |
| `Ctrl+Shift+C` | Always sends the interrupt, even with a selection — the unambiguous cancel chord. |
| `Ctrl+V` | Pastes. |
| `Shift+Enter` | Inserts a continuation (`\` + newline) rather than submitting. |

Note that `Ctrl+Shift+C` is **not** copy here, which is where it differs from most terminals — `Ctrl+C` took over that job.

### Terminal Fullscreen
Every terminal surface (a project's terminal tab, the Terminals view, the `Cmd+B` drawer) can be shown fullscreen, above the panel chrome:
- **Cell fullscreen** — one cell with its header, speech row and answer pane. Open it with the ⛶ button in the cell header or `Alt+Shift+C` (acts on the cell that last had focus; it does nothing until a cell on that surface has had focus).
- **Terminal fullscreen** — the whole terminal container (tab strip and grid). Open it with the ⛶ button in the terminal toolbar or `Alt+Shift+T`.

The same shortcut or button closes the layer, and so does navigating elsewhere. Pressing the other shortcut switches between the two layers. Fullscreen is never remembered. `Esc` does **not** close it — `Esc` always goes to the focused terminal.

### Answer Pane
Each terminal cell's answer pane shows the agent's latest answer. Toggle it with the eye button at the end of the cell's speech row (the row below the cell header), or `Alt+Shift+O` while the cell has focus. Both are available only while the speech row is shown — hide the row and the shortcut passes through to the terminal; `Esc` does not close it. Closing it yourself keeps it closed when the next answer arrives (until you show it again or reload). Its bottom-edge opacity is set per project (see Project View).

### Terminal Viewport Reader
xterm renders to a canvas, so the browser's "Read Aloud" / screen-reader / find-in-page features can't see anything. Each terminal cell has a Printer icon in its header (after the speech controls, just before the Minimise / Maximise / Fullscreen buttons) that opens a modal with a plain-DOM, fully styled snapshot of what's currently on screen.

**Open it with:**
- The Printer icon on the cell header, or
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
