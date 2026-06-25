---
name: Sydney Opera House · Home
source: https://www.sydneyoperahouse.com/
extracted: 2026-06-25
role: expressive-overlay
colors:
  ink: "#000000"          # text, primary button fill, wordmark
  paper: "#FFFFFF"         # page background
  slate: "#2B333F"         # dark slate secondary text / surfaces
  warm-1: "#F6F5F3"        # warm off-white section field
  warm-2: "#FAF5ED"        # beige field
  line: "#D4D3CF"          # warm hairline / border
  amber: "#FFAA18"         # button hover border / focus accent
  amber-soft: "#FFD464"    # soft highlight yellow
  # vivid caption-block palette (one saturated colour per card):
  block-crimson: "#C82D2D"
  block-navy: "#1A3059"
  block-purple: "#3D1D53"
  block-teal: "#1F6F78"
  block-orange: "#B4471C"
  block-pink: "#DC6281"
  block-magenta: "#852146"
  block-mustard: "#C9971A"  # use dark ink text on this one
typography:
  display:                 # heaviest weight, hero + section heads
    fontFamily: "LL Circular Pro Black → fallback: 'Century Gothic', 'Futura', 'Helvetica Neue', Arial, sans-serif"
    fontSize: "48px (hero h2/h1)"
    lineHeight: "1.25"
    fontWeight: "800-900 (Circular Black)"
    letterSpacing: "normal"
  cardTitle:
    fontFamily: "Circular Black → geometric fallback"
    fontSize: "24px"
    lineHeight: "1.33"
    fontWeight: "800"
  section:
    fontFamily: "Circular Black → geometric fallback"
    fontSize: "32px"
    lineHeight: "1.25"
    fontWeight: "800"
  body:
    fontFamily: "LL Circular Pro Book → geometric fallback"
    fontSize: "16px"
    lineHeight: "1.5"
    fontWeight: "400"
  label:                   # category eyebrow on cards
    fontFamily: "Circular Book/Bold → geometric fallback"
    fontSize: "13-14px"
    fontWeight: "700"
    letterSpacing: "0.01em"
rounded:
  button: "4px"
  card: "0px"              # poster cards are square-cornered
buttons:
  primary:
    bg: "#000000"
    color: "#FFFFFF"
    border: "3px solid #000000"
    radius: "4px"
    padding: "16px 24px"
    fontWeight: "800"
    fontSize: "20px"
    hover: "border-color → #FFAA18 (amber)"
  pill:                    # hero CTA - white/translucent pill on photo
    bg: "rgba(255,255,255,0.95)"
    color: "#000"
    radius: "999px or 4px"
    padding: "14px 22px"
hero:
  type: "full-bleed autoplay video/photo carousel, ~480px tall"
  overlay: "heavy white display headline lower-left + pill CTA; pause control + slide dots bottom-right"
---

## Overview
Sydney Opera House is **bold editorial civic**: a clean black-on-white frame around big
photography and, the signature move, **vivid solid colour-block captions beneath poster images**.
The grid of "what's on" cards is the identity - each card is a photo on top with a saturated
colour panel underneath (crimson, navy, deep purple, teal, orange, hot pink, magenta, mustard -
a different colour per card) carrying a small category eyebrow, a heavy bold title, and a date.
Type is **LL Circular Pro**, a geometric near-circular sans, used in its heaviest **Black** weight
for every headline (hero 48px, section 32px, card titles 24px) over a quiet 16px Book body. The
page opens on an **animated full-bleed hero banner**: an autoplaying video/photo carousel of the
building at golden hour, a heavy white headline lower-left ("Nothing quite like it"), a light pill
CTA ("Explore what's on"), and a pause control with slide dots bottom-right. Primary buttons are
solid black with a 4px radius and a chunky heavy label, amber border on hover. The whole read:
confident, colourful, premium-but-public, photography-forward.

Font fallback: Circular is proprietary. Use a geometric stack (`'Century Gothic','Futura',
'Helvetica Neue',Arial`) or a webfont like *Poppins*/*Montserrat* for a closer match. Headlines
MUST be heavy (800-900) - the black weight is core to the look.

## Colors
- `{ink}` `#000` / `{paper}` `#fff` - the frame: black text and buttons on white.
- `{warm-1}` `#F6F5F3` / `{warm-2}` `#FAF5ED` - warm off-white/beige section fields.
- `{slate}` `#2B333F` - dark slate for some secondary text/surfaces.
- `{amber}` `#FFAA18` / `{amber-soft}` `#FFD464` - hover/focus accent and soft highlight.
- **Caption-block palette** (`block-*`) - the expressive heart. Each poster card gets ONE
  saturated colour panel beneath it. Cycle through the eight. Text is white on all except
  `{block-mustard}` (use ink text). Saturated, confident, never pastel.

## Typography
| token | size | weight | use |
|---|---|---|---|
| display | 48px | 800-900 | hero headline |
| section | 32px | 800 | section heads ("Now showing") |
| cardTitle | 24px | 800 | film title in the caption block |
| body | 16px | 400 | meta, descriptions |
| label | 13-14px | 700 | category eyebrow on caption blocks, nav |

Geometric sans throughout; hierarchy comes from the BLACK weight + size jump, not colour or
tracking. Card title sits heavy and tight in the colour block.

## Buttons
Primary = **solid black, white text, 3px solid black border, 4px radius, ~16x24 padding, heavy
20px label**; hover swaps the border to `{amber}`. Hero CTA = a light translucent-white **pill**
sitting on the photo. No gradient fills, no big rounding.

## Cards and surfaces (the signature)
Poster card = **image on top, solid colour-block caption underneath** (radius 0). The caption block:
small category eyebrow (label, often the soft-amber or white), heavy bold title (cardTitle), a date
/meta line beneath. The colour is the differentiator; rotate the `block-*` palette so a grid reads
as a colourful mosaic. No shadows; cards separated by gutters, not borders.

## Spacing and section rhythm
Generous. Full-bleed hero, then a contained grid (3-4 cols desktop, 2 tablet, 1-2 mobile) with even
gutters. Section heads are a single heavy 32px line with a small filter row ("View: Events Tours
Stream") beneath. Whitespace and the colour blocks carry the rhythm.

## Hero / animated banner
Full-bleed (~480px+) autoplay carousel: photo/video slides with a slow Ken Burns drift and crossfade,
heavy white headline + light pill CTA lower-left, **pause/play control + slide dots bottom-right**.
Re-create without assets via CSS: 2-3 gradient "photo" slides that crossfade + slow-zoom, a real pause
button, and dot indicators.

## Application guide (→ Seat Finder "What's On")
| Region | SOH treatment |
|---|---|
| Top bar | ◐ AusCinema wordmark, geometric nav (What's on / Cinemas), search icon; Best seat / Seats together toggle |
| Hero | animated full-bleed banner, heavy white headline "Find the seat worth sitting in", pill CTA "Explore what's on", pause + dots |
| Section head | "Now showing" 32px black + a small filter row (Tonight / This week / Formats) |
| Movie grid | poster cards: gradient/duotone poster on top with a heat-coloured BEST SEAT score chip in the corner, then a vivid `block-*` caption underneath with format eyebrow, heavy film title, and "Event George St - 6 sessions tonight" |
| Primary CTA | solid black 4px-radius button, amber hover border |

Preserve the tension: a clean black-on-white civic frame, an animated photographic hero, and a
mosaic of saturated colour-block poster captions - with a small heat-coloured best-seat chip keeping
the seat-finder thesis present.
