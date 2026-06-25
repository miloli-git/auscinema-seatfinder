---
name: Glossier · AU storefront
source: https://www.glossier.com/en-au
extracted: 2026-06-25
role: expressive-overlay
colors:
  ink: "#000000"         # text, wordmark, primary button fill, rules
  paper: "#FFFFFF"        # page background
  blush: "#F6E3E6"        # signature Glossier dusty pink - the warm accent / section fields
  cloud: "#F7F7F7"        # input + soft surface grey
  line: "#E8E8E8"         # hairline dividers / borders
  ink-2: "#333333"        # secondary text
  ink-3: "#666666"        # tertiary / captions
  red: "#D30000"          # sale / alert red (used sparingly)
  link: "#0600FF"         # electric link blue (rare)
typography:
  wordmark:
    fontFamily: "Apercu → fallback: 'Gill Sans', 'Gill Sans MT', Calibri, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: "500"
    letterSpacing: "0.04em"
    textTransform: "uppercase"
  heading:
    fontFamily: "Apercu → fallback as above"
    fontSize: "20px"
    lineHeight: "1.4"
    fontWeight: "400"
  body:
    fontFamily: "Apercu → fallback as above"
    fontSize: "16px"
    lineHeight: "1.45"
    fontWeight: "400"
  label:                  # tiny uppercase tracked labels everywhere
    fontFamily: "Apercu → fallback as above"
    fontSize: "12px"
    letterSpacing: "0.06em"
    textTransform: "uppercase"
    fontWeight: "400"
  mono:
    fontFamily: "'Apercu Mono' → fallback: ui-monospace, 'SF Mono', Menlo, monospace"
rounded:
  all: "0px"              # radius 0 everywhere - the softness comes from colour + space, not corners
buttons:
  primary:
    bg: "#000000"
    color: "#FFFFFF"
    radius: "0px"
    height: "40px"
    fontSize: "14px"
    letterSpacing: "0.03em"
    hover: "marching-ants dashed black outline (animated), fill stays black"
  secondary: "transparent fill, 1px solid #000, black text, radius 0"
inputs:
  bg: "#F7F7F7"
  border: "1px solid #F7F7F7"
  radius: "0px"
  padding: "22px 8px 6px"   # floating-label style
spacing:
  rhythm: "generous, airy; product grid with wide gutters; 12px tracked labels separate sections"
---

## Overview
Glossier is **soft minimalism**: a high-key white page, near-everything in black, and one
signature warm accent - the dusty **blush pink** `{blush}` `#F6E3E6` that the brand is famous for.
There is exactly one typeface, **Apercu** (a humanist geometric grotesque; Gill Sans is the literal
fallback), used at one weight (400) for almost everything, with the wordmark at 500 uppercase and a
tiny **Apercu Mono** for fine print. Despite radius 0 everywhere, nothing feels harsh: warmth comes
from the blush fields, the airy whitespace, Apercu's friendly curves, and small **uppercase tracked
labels** (12px, +0.06em) that organise the page. Primary actions are **solid black buttons** (radius
0, 40px tall) with a playful animated **"marching-ants"** dashed outline on hover. Inputs are quiet
light-grey `{cloud}` fields with floating labels. The overall read: clean, premium, approachable,
feminine without being fussy. The opposite of a dark techy dashboard.

Font fallback: Apercu is proprietary. Use `'Gill Sans', 'Gill Sans MT', Calibri, system-ui` (the
brand's own fallback chain) or a webfont like *Hanken Grotesk* / *Mona Sans* for a closer humanist
grotesque. Do not substitute a generic geometric like Poppins; the humanist warmth matters.

## Colors
- `{ink}` `#000000` - text, wordmark, primary button fill, thin rules. The structural workhorse.
- `{paper}` `#FFFFFF` - the field. Light mode only, no off-white tint on the base.
- `{blush}` `#F6E3E6` - the signature. Use for accent panels, the selected/hero card field, tags,
  hover wash. This is what makes it read as Glossier. Spend it on warm surfaces, not text.
- `{cloud}` `#F7F7F7` / `{line}` `#E8E8E8` - input fills and hairline dividers.
- `{ink-2}` `#333` / `{ink-3}` `#666` - secondary and caption text.
- `{red}` `#D30000` (sale/alert) and `{link}` `#0600FF` (rare electric link) - accents used sparingly.

Rule of thumb: black + white + blush carry the whole design; grey for utility; red/blue almost never.

## Typography
| token | size | line-height | weight | transform | use |
|---|---|---|---|---|---|
| wordmark | 32px | 1.1 | 500 | uppercase, +0.04em | brand only |
| heading | 20px | 1.4 | 400 | none | section / hero titles |
| body | 16px | 1.45 | 400 | none | paragraphs, session meta |
| label | 12px | 1.7 | 400 | uppercase, +0.06em | section labels, tags, nav, captions |
| mono | 12-14px | - | 400 | none | scores, seat coords, fine print |

One family, one weight, big reliance on **size + uppercase tracking** for hierarchy. Numerals can use
Apercu Mono for a tabular feel (scores, seat ids).

## Buttons
Primary = **solid black, white text, radius 0, ~40px tall**, 14px label with slight tracking. Signature
hover is the **marching-ants** animated dashed black border (`border:1px dashed #000` with an animated
`background-position` on a repeating-linear dash, fill stays black). Secondary = transparent with a 1px
solid black border. No rounded buttons anywhere, no drop shadows, no gradient fills.

## Cards and surfaces
No shadows, no radius. Product/hero cards sit on white or on a **blush** field, separated by `{line}`
hairlines or whitespace. A selected item gets a blush wash rather than a heavy border. Images go edge to
edge with a small label + price beneath in 12-14px.

## Spacing and section rhythm
Airy and generous. Wide gutters in the product grid; sections introduced by a single small uppercase
tracked label (e.g. "GET THE LOOK", "SHOP ALL"). Whitespace does the dividing; rules are hairline and
quiet. Promo bar is a thin full-width strip at the very top.

## Gradients
None of brand significance. The only "gradients" are the marching-ants dashed button borders (animated
dash, not a colour fade). Keep the design flat: colour fields, not gradients.

## Application guide (→ Seat Finder)
| Seat Finder region | Glossier treatment |
|---|---|
| Promo strip | thin full-width black-on-white (or blush) bar: "Live seat data - hands off to official booking" |
| Top bar / wordmark | "AUSCINEMA SEAT FINDER" uppercase tracked wordmark, ◐ mark; quiet 12px uppercase nav |
| Mode toggle | two 12px uppercase tracked labels; active one gets a blush underline/pill, inactive grey |
| Search crumb | a quiet light-grey `{cloud}` input-style bar with floating labels (Movie / Chain / Cinema / Date) + a black "Refine" link |
| Ranked sessions | clean product-card list: white cards, hairline dividers; selected card washed in `{blush}`; time as heading, format + free as 12px label, score as a mono numeral chip |
| Hero seat map | framed on white with a `{blush}` header band; SCREEN as a thin black hairline labelled in tracked caps; keep the heat ramp but warm it (see below) |
| Heat ramp | use a cosmetics "swatch" ramp so it fits the palette and still reads: weak = pale cream, ok = blush `#F6E3E6`, good = coral `#F2A0A0`, great = warm rose `#E86A6A`, elite = deep berry `#B02E4A`; sold = `{cloud}` grey; best-pick = 1px solid black outline. Saturation/depth increases with quality so "good glows". |
| Book CTA | solid black button, radius 0, white text, marching-ants dashed hover: "BOOK ON EVENT CINEMAS ↗" |
| Seat-class tags | small radius-0 chips with 1px hairline, uppercase 12px: STANDARD / RECLINER / GOLD CLASS |

Tension to preserve: an airy black-on-white storefront warmed by blush-pink fields, with the seat
heatmap reworked as a cosmetics swatch ramp (cream → blush → coral → rose → berry) so the product
thesis still reads while staying unmistakably Glossier.
