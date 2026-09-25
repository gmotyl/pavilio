---
name: pavilio-mockup
description: Write a visual mockup as one self-contained HTML file under `projects/<project>/mockups/`, viewable in the project's Mockups tab. Use when the user invokes `/pavilio-mockup`, says "mock this up", "show me options for …", "draft a mockup", or when [[pavilio-ui-design]] delegates the writing after settling the design.
---

# Pavilio Mockup

Writes the mockup file. This skill owns **where a mockup lives and what shape it has** — destination, filename, self-containment, comparison structure. It carries no design opinions; the design judgment belongs to [[pavilio-ui-design]], which calls this skill to do the writing.

Invoked directly with a description, it writes the mockup straight away — no routing through [[pavilio-ui-design]], no design interview.

## Usage

```
/pavilio-mockup [<project>] <what is being decided>
```

## Resolve the project first

1. Use the project named in the invocation.
2. Otherwise infer it from the working directory (the `projects/<project>/` you are in, or the project whose repo this is per `.projects.local.md` / `repos.json`).
3. If neither resolves — **ask which project and stop.** One question, then end the turn. Never guess a destination.

## Destination

`projects/<project>/mockups/YYYY-MM-DD-slug.html`

- Date is today.
- Slug is kebab-case and names **the decision**, not the surface or the file type — `boot-legend-options`, not `panel-html` or `mockup2`.
- Create `mockups/` if it does not exist.
- Never overwrite an existing file without asking; add a distinguishing slug instead.

## Self-contained output — non-negotiable

All CSS in one inline `<style>`; all JS (if any) in an inline `<script>`. **No external URL of any kind** — no CDN script, no stylesheet link, no Google Fonts, no remote image, no `url()` fetch.

Why: the panel renders the file in an iframe under an opaque origin via `sandbox="allow-scripts"` with **no** `allow-same-origin`, and the panel is routinely used offline or over LAN. Anything external silently fails to load and the mockup renders wrong or blank.

Consequences to design around:
- Fonts: system stacks only (`ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`, or `ui-monospace, monospace`).
- Images/icons: inline SVG, CSS shapes, or text glyphs. Data URIs only if small.
- No frameworks. Hand-written HTML + CSS; JS only when the point being made needs interaction.
- Self-contained also means self-explanatory: no dependency on the reader having the conversation open.

## Default shape: a comparison

Unless the caller states the direction is already settled, present **two to four options**:

```html
<title>Boot legend — options</title>
…
<h1>Boot legend — three options</h1>
<p class="sub">One or two sentences: what surface this is, what is actually being decided.</p>

<h2>A — Callouts with leader lines <span class="tag rec">recommended</span></h2>
<p class="note">What it is and what it costs.</p>
<!-- the rendered option -->

<h2>B — Legend card under the wave <span class="tag">quietest</span></h2>
…

<hr>
<h2>Recommendation</h2>
<p class="note"><b>A, reduced to two callouts</b> — why this one, in terms of the decision.</p>
```

Rules:
- Options are lettered `A`, `B`, `C`… in the heading.
- Exactly one option carries a `recommended` tag; other tags are optional one-word characterisations (`quietest`, `most teaching`).
- Every option is **rendered**, not described — draw the real surface at real proportions where you know them.
- The file closes with a `Recommendation` section that picks one and says why.

**Single-option exception:** when the caller says the direction is already decided, render that one design and skip the lettering and the Recommendation section. Do not invent alternatives to fill the shape.

## Name the decision

`<title>` and the top-level `<h1>` name the **decision being made** — "Boot legend — three options", "Sidebar collapse behaviour" — never the filename, the project, or "Mockup".

## Report

File path, plus: viewable in the project's **Mockups tab** in the panel. If the panel is open, the tab picks it up without a restart.

## Non-goals

- **Makes no design judgments.** Colour, type, layout, copy voice, what is worth designing at all — that is [[pavilio-ui-design]]'s job. This skill renders the direction it is given.
- Does not interview the user about the design. The only question it ever asks is which project.
- Does not edit application code, `PROJECT.md`, `STATUS.md`, or specs.
- Does not commit — it writes the file and reports.
