# UI Design Prompt — Canvas + Panel Shell

Paste the block below into any AI coding tool to reproduce this shell in another
project. It is written as a specification rather than as a request, because
vague instructions ("make it look like ChatGPT") produce vague results.

Everything in it is already implemented in `theme-flow.css` in this repo, so you
can also read that file as the reference implementation.

---

## THE PROMPT

```
Restyle the application shell using the layout model below. Do not restructure
the HTML unless a required element is missing. Do not change the colour palette
or fonts if the project already has them — this is a LAYOUT and INTERACTION
specification, and it must sit on top of the existing theme.

=== 1. THE CORE IDEA: CANVAS AND PANEL ===

The window is a flat neutral CANVAS. The content is a single ELEVATED PANEL
floating on that canvas. The sidebar is part of the canvas, not a panel.

Consequences, all of which matter:
  - The sidebar has NO right border, NO background of its own, NO shadow.
    It shares the body background.
  - The content panel is inset from the window edges by 8px on all sides,
    has a 16px border radius, and carries the only real shadow in the layout.
  - The panel shadow is layered, not a single blur:
      0 0 0 1px  <hairline, ~4.5% ink>
      0 1px 2px  <contact, ~5% ink>
      0 12px 32px -8px  <mid, ~10% ink>
      0 40px 80px -32px <ambient, ~14% ink>
    A single large blur reads as fog; four stacked layers read as depth.
  - The panel is a flex column: a fixed-height header row, then a flexible
    scrolling body.

=== 2. SIDEBAR ===

Width 215px expanded, ~62px collapsed. Fixed position, full viewport height.

Navigation rows:
  - min-height 30px, padding 6px 10px, border-radius 8px, margin 1px 8px
  - font-size 13px, weight 450, letter-spacing -0.005em
  - icon 17px at 62% opacity, same colour as the label — never accent-coloured
  - label truncates with ellipsis; it must never wrap to a second line

Three states, and only three:
  - rest    : transparent background, muted text colour
  - hover   : background = 4.5% ink wash, text = full contrast
  - active  : background = 7% ink wash, weight 550, text = full contrast

The active state MUST be a neutral grey pill. Do not use the accent colour, a
gradient, a left border marker, or a glow. Restraint here is the whole point:
navigation should recede so the content is the only thing with presence.

Remove any decorative ::before / ::after markers, sliding indicator pills, and
cursor-following glows that an earlier stylesheet added.

Section labels ("Pinned", "Recents"): 11px, weight 600, muted, 75% opacity,
sentence case — not uppercase, not letter-spaced wide.

Collapsed rail: icons centred, all labels and section headings hidden.

Sidebar footer: separated by a single hairline. Any card in it is flat —
transparent background, hairline border, no shadow.

=== 3. PANEL HEADER ===

  - Fixed height ~52px, flex-shrink 0
  - Same background as the panel
  - ONE hairline border along the bottom. No shadow, no blur, no gradient.
  - Title at 14px weight 550 on the left; icon buttons on the right
  - Icon buttons: 8px radius, transparent, background wash on hover only.
    No lift, no shadow.

=== 4. READING COLUMN ===

This is the single most important rule and the one most often skipped.

Conversation content is NOT full width. It sits in a centred column of about
46rem (~736px) with generous empty margins on both sides. Apply it to the
message list, the greeting block, the composer and the footer note, so they all
share one optical centre line.

Data-heavy views — tables, dashboards, card grids — are exempt and use the full
panel width. Constraining a table to a reading column wastes the panel.

=== 5. MESSAGES ===

Assistant messages:
  - NO bubble. Plain text directly on the panel.
  - transparent background, no border, no padding, no radius
  - 15px, line-height 1.72
  - small avatar (26px) with a hairline border, in a fixed-width column

User messages:
  - right-aligned, max-width 72%
  - soft neutral bubble, border-radius 20px, padding 11px 16px
  - no border, no shadow, no avatar
  - light theme bubble ≈ #F0EEEA, dark ≈ #262523

Bubbling BOTH sides is the most common mistake and instantly dates the design.
Only the user's own words get a container.

Inside assistant prose: paragraphs 1em apart, last paragraph margin 0, code
blocks on the canvas colour with a hairline and 12px radius, inline code with a
subtle wash and 5px radius.

=== 6. SCROLLBARS ===

Scrollbars belong INSIDE the panel, never at the window edge.

  - 12px track width, fully transparent track
  - thumb inset using `border: 4px solid transparent` with
    `background-clip: content-box` — this is what makes it read as a thin
    rounded bar rather than a wide grey stripe
  - thumb colour = the same 7% ink wash used by the active nav state
  - border-radius 99px, min-height 40px
  - darker on hover
  - hide ::-webkit-scrollbar-button and make ::-webkit-scrollbar-corner
    transparent
  - also set `scrollbar-width: thin` and `scrollbar-color` for Firefox

CRITICAL: establish exactly ONE scroll surface per view. If a container and its
child both have `overflow-y: auto`, the user gets two nested scrollbars. The
outer container should be `overflow: hidden` and stretch; the inner active view
scrolls.

=== 7. COMPOSER ===

  - Fully rounded pill: border-radius 26px
  - padding 8px 8px 8px 16px, flex row, align-items flex-end
  - textarea: transparent, borderless, no resize handle, 15px,
    min-height 24px growing to max-height 200px
  - icon buttons: 30px circles, transparent, wash on hover
  - send button: 32px filled circle in the accent colour, white glyph
  - focus: accent border plus a 3px accent ring at ~24% opacity
  - centred on the same reading column as the messages

=== 8. CARDS INSIDE THE PANEL ===

The panel already carries the elevation. Nesting more shadows inside it looks
muddy.

  - Inner cards: panel background, 1px hairline border, NO shadow, 14px radius
  - hover: border brightens to the active wash + a small 4px 14px -6px shadow
    and a 2px lift via translate3d
  - Remove ::before gradient overlays from cards

=== 9. MOTION — THE 60FPS RULES ===

These are not stylistic preferences. Breaking them causes dropped frames.

  1. Animate ONLY transform, opacity and colour. Those are the properties the
     compositor can handle without recalculating layout.
  2. NEVER write `transition: all`. It makes the browser watch layout
     properties you did not intend to animate.
  3. NEVER transition width, height, top, left, right, bottom, margin or
     padding. If a sidebar collapse changes the content margin, let the margin
     SNAP and animate the sidebar itself with `transform: translateX()`.
     A 0ms snap is smoother than a 260ms animation that drops frames.
  4. Use translate3d for hover lifts so the element gets its own layer.
  5. Apply `will-change: transform` only while the pointer is over the parent
     container, then reset it. Holding hundreds of permanent layers costs more
     memory than it saves in paint time.
  6. Keep `backdrop-filter` for true overlays only. On many simultaneous cards
     it is one of the most expensive properties there is.
  7. Long lists: `content-visibility: auto` with `contain-intrinsic-size` so
     offscreen rows are skipped.
  8. Easing: cubic-bezier(0.22, 1, 0.36, 1). Durations 140ms for state changes,
     260ms for movement, 480ms for entrances.
  9. Honour BOTH `@media (prefers-reduced-motion: reduce)` and any in-app
     motion setting.

=== 10. STYLESHEET ORDER ===

If the project has several stylesheets that use !important heavily, this theme
layer MUST be the LAST stylesheet in the document. A single stylesheet loading
after it will silently undo parts of the theme, which is very hard to debug.
Add a comment saying so at the link tag.

=== 11. VERIFY, DO NOT ASSUME ===

Before reporting the work as done, check and report on each of these:

  - every route resolves to a real view section
  - every sidebar link resolves to a real view section
  - every referenced stylesheet and script exists on disk
  - the theme layer is the last stylesheet
  - no duplicate element IDs (getElementById silently returns only the first)
  - every inline onclick handler resolves to a defined function
  - the theme file has balanced braces and closed comments
  - the theme contains no `transition: all` and no layout-property transition
  - exactly one scroll surface per view

State clearly which of these you verified and which you could not.
```

---

## Notes on using this prompt

**Give the tool the reference file.** If you can, point it at `theme-flow.css`
in this repo. A specification plus a working implementation produces far better
results than a specification alone.

**Ask for verification, not reassurance.** The final section exists because an
AI will otherwise report "done" without checking. This repo has those checks
automated:

```
npm test
```

**The rules most often broken**, in order:

1. The reading column is skipped and content goes full width.
2. Assistant messages get a bubble.
3. `transition: all` survives somewhere.
4. Two nested scrollbars appear because a container and its child both scroll.
5. The theme layer ends up not last in the cascade.

If the result feels wrong but you cannot say why, check those five first.
