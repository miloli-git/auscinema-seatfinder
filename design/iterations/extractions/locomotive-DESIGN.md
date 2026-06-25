---
name: Locomotive · Montreal web agency homepage
source: https://locomotive.ca/en
extracted: 2026-06-25
role: expressive-overlay
colors:
  ink: "#000000"        # near-everything: text, rules, marks
  paper: "#FFFFFF"       # page background
  electric: "#312DFB"    # menu overlay bg only — single saturated accent
  btn-ink: "#30363c"     # near-black used on cookie/secondary UI chrome
  muted: "#5e6266"       # secondary text (footer)
typography:
  display:               # giant editorial heads
    fontFamily: "LocomotiveNew (proprietary serif) → fallback: 'Times New Roman', Georgia, serif"
    fontSize: "70px (≈7.64vw fluid, --font-size-huge)"
    lineHeight: "1.1"
    fontWeight: "400"
    letterSpacing: "normal"
  heading:               # section heads / featured titles
    fontFamily: "HelveticaNowDisplay (proprietary grotesque) → fallback: 'Helvetica Neue', Arial, sans-serif"
    fontSize: "26px"
    lineHeight: "1.2"
    fontWeight: "400"
  body:
    fontFamily: "HelveticaNowDisplay → fallback: 'Helvetica Neue', Arial, sans-serif"
    fontSize: "15px"
    lineHeight: "1.3"
    fontWeight: "400"
rounded:
  all: "0px"             # sharp everywhere — no radius anywhere on the page
borders:
  rule: "2px solid #000" # structural rules / underlines
  hairline: "1px solid #000"  # row dividers in catalogue lists
spacing:
  micro: "14px"
  tiny: "20px"
  small: "30px"
  medium: "40px"
  large: "80px"
  big: "150px"
  huge: "200px"
  enormous: "250px"
grid:
  columns: 12
  gutter: "20px"
  margin: "2.667rem"
---

## Overview
Locomotive is Swiss-brutalist editorial: a **pure black-on-white** canvas with one
electric-blue full-bleed moment (the menu overlay). The distinctiveness is not colour — it
is *type contrast and structure*. A proprietary **serif display** face (LocomotiveNew) sets
enormous catalogue headings ("Extras", "(13)") against a neutral **grotesque sans**
(HelveticaNowDisplay) for everything else. Layout is a strict 12-column grid with **hairline
rules** dividing label/content rows, generous whitespace, sharp corners (radius 0 everywhere),
and an index/catalogue habit of parenthetical counts `(13)`, `(2024)`. Kinetic typographic
fragments ("Always looking for top shelf talent") animate in, but the static system is
calm and confident. No gradients of consequence, no shadows, no rounded buttons — links are
plain text, sometimes underlined. The whole tone reads as a printed annual report crossed with
a fashion lookbook.

Font fallback: both faces are proprietary. Substitute the serif with a high-contrast didone-ish
serif (`'Times New Roman'`/Georgia is the literal fallback in their stack; for production use a
webfont like *Editorial New* or *Fraunces*), and the sans with `'Helvetica Neue', Arial,
system-ui` (or *Inter*/*Söhne* for a closer grotesque).

## Colors
- `{ink}` `#000000` — used for ~90% of marks: all text, every rule and underline, the wordmark.
- `{paper}` `#FFFFFF` — page field. The design is light-mode, high-key, no off-white tint.
- `{electric}` `#312DFB` — the ONLY saturated colour. Reserved for the full-screen menu overlay
  background (`--menu-color-bg`), text reversing to white on it. Use as a rare full-bleed accent,
  never as a small button fill.
- `{btn-ink}` `#30363c` / `{muted}` `#5e6266` — near-black + grey confined to utility chrome
  (cookie banner, footer). Not part of the expressive palette.

Rule of thumb: build in black/white only; spend `{electric}` once, on a single takeover surface.

## Typography
| token | family | size | line-height | weight | use |
|---|---|---|---|---|---|
| display | serif (LocomotiveNew) | 70px / 7.64vw fluid | 1.1 | 400 | hero + section headings, catalogue counts |
| heading | sans (HelveticaNowDisplay) | 26px | 1.2 | 400 | featured-work titles, nav, link lists |
| body | sans | 15px | 1.3 | 400 | paragraphs, metadata, captions |
| h3/label | sans | 15px | 1.3 | 400 | row labels (work names) |

Letter-spacing is `normal` throughout — the type does the work, no tracking tricks. Weight stays
**400** almost everywhere (the serif's contrast supplies emphasis, not bold sans). The signature
move is the **size jump**: 70px serif heads sitting directly above 15px sans body, with little in
between. Numerals appear in parentheses as catalogue indices.

## Buttons
There are effectively **no filled buttons**. CTAs ("Let's talk", "Subscribe", "Menu") are
plain text links at heading size (26px), black, no background, no border, no radius, no padding
beyond line spacing. Hover is an underline or colour shift. The only "primary button" anywhere is
the cookie modal's `#30363c` pill (utility chrome, `.4rem` radius) — do NOT treat that as the brand
button. For the brand voice, a CTA = oversized underlined text, optionally with a `↓`/`↗` glyph.

## Cards and surfaces
No cards. No shadows. No fills. Content is organised by **hairline rules**: each list item is a
row separated by a 1px black divider, with a left label column and a right content column. Featured
work uses image tiles edge-to-edge with a small sans caption beneath. Everything is radius 0 and
sits directly on paper. Structure comes from rules and the grid, not containers.

## Spacing and section rhythm
A wide spacing scale (`14 → 250`) drives big vertical breathing room. Sections are separated by
`large`/`big` gaps (80–150px), inner rows by `tiny`/`small` (20–30px). Page gutter is `2.667rem`
margins on a 12-col / 20px-gutter grid. The page feels *empty on purpose* — large headings float
in whitespace, then dense hairline-ruled lists provide rhythm.

## Gradients
None of brand significance. The single observed gradient is a white-to-transparent fade behind a
newsletter modal (`linear-gradient(0deg, rgba(255,255,255,0) 0%, #fff 50%)`) — a scrim, not a fill.
Do not introduce decorative gradients; this system is flat ink-on-paper.

## Application guide (→ Seat Finder)
| Seat Finder region | Locomotive treatment |
|---|---|
| Top bar / wordmark | black text wordmark + `®`, plain-text nav links at 26px; mode toggle = two underlined text links, active one solid-underlined |
| Search crumb | hairline-ruled single row: left label "NOW SHOWING", right = "Toy Story 5 · Event George St · Tonight", a text "Refine ↓" link |
| Ranked sessions | catalogue list — each session a hairline-ruled row: left = serif index `(01)`, big serif time, right = format + cinema + free count; score as a large serif numeral, no pill |
| Hero seat map | the one place colour is allowed: keep the heat ramp, but frame the map sharp-cornered on paper with a 2px rule and a serif caption `Auditorium (Screen 8)`; SCREEN as a thin black rule labelled in tracked sans caps |
| Book CTA | oversized underlined text link "Book on Event Cinemas ↗", black, no fill |
| Section counts | parenthetical serif counts: "Sessions (6)", "Best seat (94)" |

The tension to preserve: enormous serif numerals + hairline catalogue rows on white, with the seat
heatmap as the single chromatic event on the page.
