# DESIGN.md — AusCinema Seat Finder (locked v1)

Seat-map-as-hero rebuild, shipped 2026-06-24. Tokens: `design/tokens.css`. Static reference:
`design/mock-v1.html`. Applied in `apps/web/src/styles.css` + components.

## 1. Overview / Narrative
A purpose-built tool, not a SaaS dashboard. The product thesis — "which seat is actually worth
sitting in" — is the hero: a heat-mapped auditorium plan you can read at a glance. Everything else
(search, tuning) collapses out of the way once you've searched. Dark-only by intent; confident,
functional, terse. Distinctive marks: the ◐ half-moon wordmark, a restrained amber+blue accent pair
(deliberately not the purple-gradient AI cliché), and the seat heatmap itself.

## 2. Layout
- **Top bar:** ◐ wordmark + a pill-shaped **search crumb** ("Movie · Chain · Cinema · Date · Refine")
  that toggles the form drawer. Progressive disclosure: tuning is hidden until asked for.
- **Refine drawer:** the full query + seat-preference form, in a 2-col grid (1-col under 560px).
  Open by default on first load; auto-collapses to the crumb after a successful search.
- **Stage (post-search):** 2-col grid — a **ranked session rail** (320px) on the left, the **hero
  seat map** filling the rest. Under 900px it stacks; the rail becomes a horizontal scroll-snap strip.
- **Hero:** session head (time · format, cinema/screen/seats) + Book CTA, the curved SCREEN marker,
  the seat grid (scrolls inside its own box), then the quality ramp + legend + class tags.
- **Mobile:** Book is a sticky bar pinned to the thumb zone. Nothing forces horizontal page scroll
  (`* { min-width: 0 }` + per-region `overflow-x:auto`).

## 3. Typography
System stack (`ui-sans-serif, system-ui, …`) — no Inter, no webfont. A 1.25-ish scale:
12 / 14 / 16(base) / 20 / 25 / 32. Headlines 700–750 with slight negative tracking; body 1.55
line-height; numerals tabular in score pills. Plain-language control labels ("How far back",
"Aisle ↔ centre") over the old abstract math.

## 4. Color
Tokens in `tokens.css`. Surfaces ramp #0a0c10 → #1b2030; text #eef2f8 / #aeb7c6 / #818b9c (AA on bg).
Accents: amber `--accent #f5b941` (actions, brand), blue `--info #5aa9ff` (focus, screen).
**Seat-quality ramp (the core signal):** weak `#4a566b` → ok `#f08a4b` → good `#f5b941` →
great `#8fd14a` → elite `#2fd27a`; sold `#1c2330`; best-pick = white outline. Five discrete steps,
applied via a `data-q` attribute, so "good vs meh" reads instantly (v0's continuous blue→green lerp
made every available seat look the same green).

## 5. Components
- **Score pill** (rail): tabular number + "best" caption, banded elite/great/good.
- **Session row** (`.sess`): button, `aria-pressed` selected state, drives the hero.
- **Seat** (`.seat[data-q]`): 22px tile; `data-best` outline; `data-paired` inset ring.
- **Chips** (cinemas selected / seat classes), **checklist** (filterable cinema picker), **ramp bar**.
- **Buttons:** primary (amber), ghost (the crumb/Refine toggle); 44px min height.

## 6. States & Motion
- **Loading:** "Searching sessions…", "Loading seat map…"; submit disabled until ready.
- **Empty:** first-run guidance card; "Pick a session…" before a hero map loads.
- **Error:** `role=alert` banner for search; inline warn hints for cinema/movie/seat-map failures.
- **Focus:** global `:focus-visible` (2px blue outline) on every interactive element.
- **Motion:** 0.12–0.14s ease-out-quint on hover/border only. No bounce, no layout animation.

## Re-critique delta (v0 → v1)
- Technical audit ~12/20 → ~18/20. Responsive **1 → 4** (overflow gone, sticky book, 44px targets,
  horizontal rail). A11y **2 → 3** (focus-visible, seat-map alt). Anti-patterns **3 → 4** (no Inter,
  real scale, distinctive hero).
- Nielsen ~30/40 → ~33/40. Aesthetic/minimalist **3 → 4** (progressive disclosure killed the
  control-wall and the desktop empty void).
- Remaining (intentional / lower priority): individual seats aren't keyboard-focusable (grid is an
  `img` with alt — fine for a heatmap); no keyboard shortcuts / saved queries.
