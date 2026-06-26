# 04 · Wireframes C1 + C2 — Movie-Forward Reframe

Second-diamond / Develop. **Stage 8** (wireframes). Built on
[03 · Flows + Concepts](./03-flows-and-concepts.md). See the [journey index](./README.md) for the walk.

**Deliberately lo-fi:** grayscale, mobile-first, ASCII blueprints. No colour, no brand, no real type.
The point is to solve **structure, hierarchy, nav, components, and states** before any styling. A
polished mock here would hide weak product thinking. Once the structure tests well, Stage 9 turns
these into a grayscale clickable HTML prototype.

Two concepts wireframed so the first usability test can compare two real decision models:
- **C1 — Tradeoff Chooser** (the spine; tests "users want to pick the tradeoff").
- **C2 — Best Option First** (the contrast; tests "users prefer one confident pick").

Both share the entry and the option-detail screen, so the test isolates the **decision model** itself.

Legend: `[ ]` button/chip · `( )` toggle · `____` input · `▓` grayscale map cell · `»` handoff.

---

## Shared — Screen 0: Entry

Skip-to-results means entry is minimal; defaults do the work.

```
+--------------------------------+
| AusCinema            [ menu ]  |
+--------------------------------+
|                                |
|  See a film, well.             |
|                                |
|  ____________________________  |   <- film search (primary, autofocus)
|  | Search a film...        |  |
|  ----------------------------  |
|                                |
|  ( Search a film )  ( What's on ) <- entry toggle; browse is co-equal
|                                |
|  Recent / showing near you:    |   <- cheap browse affordance, not full landing yet
|  [ Film A ] [ Film B ] [ Film C ]
|                                |
+--------------------------------+
```
Annotations:
- Default tab = film search. "What's on" swaps the body for the browse grid (the SOH surface,
  wireframed separately later). Both resolve to a title, then go to Screen 1.
- No context form here. Context is assumed (near me / tonight / 2) and shown editable on Screen 1.

---

## C1 — Screen 1: Best Ways view (the heart)

```
+--------------------------------+
| < Dune: Part Two        [edit] |   <- film pinned as fixed context (title = constant)
+--------------------------------+
| Near me · Tonight · 2 seats  v |   <- context summary, tap to edit inline (assumed defaults)
+--------------------------------+
| What matters tonight?          |
| [Best seats]*[Best screen][Soonest]  <- LENS CHIPS, one active (*). Re-ranks in place.
+--------------------------------+
| TOP FOR BEST SEATS             |   <- section label reflects active lens
| +----------------------------+ |
| | Event George St · 7:40pm   | |   <- session card
| | Recliner · ▓▓▓▓░ good seats | |   <- seat-quality signal (grayscale)
| | Why: most A-grade seats left| |   <- one-line "why" tied to active lens
| +----------------------------+ |
| +----------------------------+ |
| | Hoyts EQ · 8:15pm          | |
| | Standard · ▓▓▓░░ ok seats  | |
| | Why: good seats, later start| |
| +----------------------------+ |
| +----------------------------+ |
| | Village Crown · 9:00pm     | |
| | Vmax · ▓▓░░░ filling        | |
| +----------------------------+ |
+--------------------------------+
```
Annotations:
- **Film title is fixed at the top of every screen** — the user never leaves "seeing this film".
- Lens chips re-rank the **same candidate set** and rewrite each card's "Why" line. No reload, no nav.
- Card hierarchy: cinema+time (scan), format+seat-signal (judge), why-line (trust). Tap = Screen 2.
- Cross-chain is present (cinema name) but not the headline.

### C1 — Screen 1b: No-good-seats honest state (same screen, different content)
```
+--------------------------------+
| < Dune: Part Two        [edit] |
+--------------------------------+
| Near me · Tonight · 2 seats  v |
+--------------------------------+
| No great seats left nearby     |   <- honest banner, first-class content not an error
| tonight. Your real options:    |
| [ Later session, same cinema ] |   <- each = relax one constraint -> re-runs Screen 1
| [ Further cinema, better seats]|
| [ Different night ]            |
+--------------------------------+
```

---

## Shared — Screen 2: Option detail (seat-quality view)

Same for C1 and C2 so the test isolates the decision model, not the detail screen.

```
+--------------------------------+
| < Event George St · 7:40pm     |
+--------------------------------+
| Dune: Part Two · Recliner      |
| Good seats likely until ~7:10  |   <- availability confidence (the trust line)
+--------------------------------+
|        S C R E E N             |
|   ▓▓ ▓▓ ▓▓ ▓▓ ▓▓ ▓▓ ▓▓         |   <- seat-quality map, grayscale heat (darker = better)
|   ▓▓ ██ ██ ██ ██ ▓▓ ▓▓         |      (██ = best zone; real geometry from captured layouts)
|   ░░ ██ ██ ██ ██ ░░ ░░         |
|   ░░ ░░ ▓▓ ▓▓ ░░ ░░ ░░         |
|                                |
|  Best zones still open: centre |   <- plain-language readout of the map
|  rows D-F. 2 seats together: ok|   <- party constraint checked BEFORE handoff
+--------------------------------+
| [ » Book on Event official ]   |   <- handoff, always visible once option chosen
+--------------------------------+
```
Annotations:
- Seat map leads with **meaning** (best zones / seats-together check), not raw availability.
- The map is the one place the chosen visual direction lands in the second diamond.
- Handoff carries cinema + session + shown-seats so the official page feels like a continuation.

---

## C2 — Screen 1: Best Option First (the contrast)

Same entry (Screen 0) and same option detail (Screen 2). Only the decision screen differs.

```
+--------------------------------+
| < Dune: Part Two        [edit] |
+--------------------------------+
| Near me · Tonight · 2 seats  v |
+--------------------------------+
| YOUR BEST WAY TONIGHT          |
| +----------------------------+ |
| | Event George St · 7:40pm   | |   <- ONE hero recommendation
| | Recliner · ▓▓▓▓░ good seats | |
| | Best balance of great seats| |   <- reason baked in, no lens choice
| | and a comfortable recliner | |
| | [ See seats & book » ]     | |
| +----------------------------+ |
|                                |
| Other ways:                    |   <- alternatives, each tagged by the tradeoff it wins
| [ Bigger screen, further  > ]  |
| [ Better seats, later     > ]  |
| [ Soonest start           > ]  |
+--------------------------------+
```
Annotations:
- No lens chips. The product **commits to one ranking** and explains it; alternatives are escape
  hatches tagged by their tradeoff.
- Lower cognitive load; the bet it tests is the opposite of C1's (A3). If users reach for the
  "other ways" tags constantly, that is evidence *for* C1.

---

## What the usability test will compare (Stage 10 preview)
Same task on both: *"You want to see a specific film this Saturday night with one other person.
Find the option you'd actually book."* Watch:
- Do they understand **why** an option is top (C1 why-line vs C2 baked reason)?
- C1: do they use the lens chips, or ignore them? C2: do they fall back to "other ways" a lot?
- Do they trust the seat logic on Screen 2 (shared)?
- Is the handoff clear or a dead end?

## Open structure questions (before the Stage 9 prototype)
- Is the **C1 Best Ways card** carrying the right three signals (cinema+time / format+seat-signal /
  why-line), or is one missing (e.g. price, distance)?
- Is the **shared Screen 2** the right level of seat detail for a first test, or too much / too little?
- Anything in the **no-good-seats state** to frame differently?
