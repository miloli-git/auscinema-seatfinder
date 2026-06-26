# 04 · Wireframes C1 + C2 — Movie-Forward Reframe

Second-diamond / Develop. **Stage 8** (wireframes). Built on
[03 · Flows + Concepts](./03-flows-and-concepts.md). See the [journey index](./README.md) for the walk.

**Deliberately lo-fi:** grayscale, mobile-first, ASCII blueprints. No colour, no brand, no real type.
The point is to solve **structure, hierarchy, nav, components, and states** before any styling. A
polished mock here would hide weak product thinking. Once the structure tests well, Stage 9 turns
these into a grayscale clickable HTML prototype.

> Revised after a Codex UX review (2026-06-26): headcount input is a **per-day stepper** (not a
> slider); the organiser is a **visible mode** in the context bar (not a hidden tap); turnout is a
> three-tier **Together / Nearby / Split** model; copy tightened to stop leaking RSVP.

Two concepts wireframed so the first usability test can compare two real decision models:
- **C1 — Tradeoff Chooser** (the spine; tests "users want to pick the tradeoff").
- **C2 — Best Option First** (the contrast; tests "users prefer one confident pick").

Both share the entry, the group panel, and the option-detail screen, so the test isolates the
**decision model** itself. Both serve two personas: a **solo** user (defaults, skips straight to
results) and a **group organiser** (switches on "Plan group", sets a per-day headcount).

Legend: `[ ]` button/chip · `( )` toggle · `____` input · `[− N +]` stepper · `▓` grayscale map cell · `»` handoff.

---

## Shared — Screen 0: Entry

Skip-to-results means entry is minimal; defaults do the work. The persona (just me / plan a group)
is chosen on the results context bar, not here — so the solo path stays one tap to results.

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

The context bar carries a **visible persona toggle** — `Just me / Plan group` — so the organiser path
is first-class, not discovered. Solo (default) shows three lens chips and no fit count. Group mode
(below) adds the per-day stepper panel, a 4th chip, and a group-fit tier on each card.

```
+--------------------------------+
| < Dune: Part Two        [edit] |   <- film pinned as fixed context (title = constant)
+--------------------------------+
| Near me · This week            |
| ( Just me )  ( Plan group* )   |   <- visible persona toggle; group active
+--------------------------------+
| How many likely each day?      |   <- group panel (only in Plan group); days w/ no screening hidden
|  Tue 24   [− 6 +]              |   <- per-day STEPPER (small integers, not a slider)
|  Wed 25   [− 7 +]              |
|  Thu 25   [− 4 +]              |
+--------------------------------+
| What matters?                  |
| [Best seats][Screen][Soon][Most together]*  <- 4th chip only in group mode
+--------------------------------+
| TOP FOR MOST TOGETHER          |   <- section label reflects active lens
| +----------------------------+ |
| | Event George St · Wed 7:40 | |   <- session card (day shown; counts vary by day)
| | Recliner · ▓▓▓▓░ · all 7 together
| | Why: all 7 in one block, centre
| +----------------------------+ |
| +----------------------------+ |
| | Hoyts EQ · Tue 8:15  (~)   | |   <- (~) = approximate geometry, lower confidence
| | Standard · ▓▓▓░░ · 6 nearby | |   <- Together / Nearby / Split tier
| | Why: whole Tue group, split pairs
| +----------------------------+ |
| +----------------------------+ |
| | Village Crown · Wed 9:00   | |
| | Vmax · ▓▓░░░ · 5 of 7      | |   <- partial fit surfaced honestly on the card
| +----------------------------+ |
+--------------------------------+
```
Annotations:
- **Film title fixed at the top of every screen** — the user never leaves "seeing this film".
- Lens chips re-rank the **same candidate set** and rewrite each card's "Why". No reload, no nav.
- Group-fit is a **tier**, not a raw count: `all N together` / `N nearby` (split pairs, adjacent rows)
  / `M of N` (fragmented). `(~)` flags chains with approximate geometry (Hoyts) as lower confidence.
- Card hierarchy: cinema+day+time (scan), format+seat-signal+fit (judge), why-line (trust). Tap = Screen 2.

### C1 — Screen 1b: Honest states (same screen, different content)
No good seats (solo or group):
```
| No great seats left nearby     |
| tonight. Your real options:    |
| [ Later session, same cinema ] |
| [ Further cinema, better seats]|
| [ Different night ]            |
```
Partial group (group mode):
```
| 6 of your 7 fit together here  |   <- 'together', not 'attend' — avoids the "only 6 can come" misread
| All 7 together at Tue 8:15     |   <- the alternative that actually works, named
| [ See Tue 8:15 — all 7   »]    |
| [ Book here for 6        »]    |   <- both real moves offered; product doesn't pick silently
```

---

## Shared — Screen 2: Option detail (seat-quality view)

Same for C1 and C2 so the test isolates the decision model, not the detail screen. The group-fit line
appears in group mode and names the tier + actual rows.

```
+--------------------------------+
| < Event George St · Wed 7:40   |
+--------------------------------+
| Dune: Part Two · Recliner      |
| Good seats likely until ~7:10  |   <- availability confidence (the trust line)
| All 7 together — rows D-E       |   <- group-fit tier + rows (group mode only)
+--------------------------------+
|        S C R E E N             |
|   ▓▓ ▓▓ ▓▓ ▓▓ ▓▓ ▓▓ ▓▓         |   <- seat-quality map, grayscale heat (darker = better)
|   ▓▓ ██ ██ ██ ██ ▓▓ ▓▓         |      (██ = best zone; real geometry from captured layouts)
|   ░░ ██ ██ ██ ██ ░░ ░░         |
|   ░░ ░░ ▓▓ ▓▓ ░░ ░░ ░░         |
|                                |
|  Best zones still open: centre |   <- plain-language readout of the map
|  rows D-F. 7 together: rows D-E |   <- group adjacency checked BEFORE handoff
+--------------------------------+
| [ » Book on Event official ]   |   <- handoff, always visible once option chosen
+--------------------------------+
```
Annotations:
- Seat map leads with **meaning** (best zones / can-the-group-sit-together), not raw availability.
- Group-fit is the three-tier model: **Together** (one contiguous block), **Nearby** (split pairs /
  adjacent rows), **Split** (fragmented). Ranking prefers *together*, with seat quality as tiebreaker
  so it can't favour 7 poor front-row over 6 great centre seats.
- The map is the one place the chosen visual direction lands in the second diamond.
- Handoff carries cinema + session + shown-seats so the official page feels like a continuation.

---

## C2 — Screen 1: Best Option First (the contrast)

Same entry (Screen 0), persona toggle + group panel, and option detail (Screen 2). Only the decision
screen differs.

```
+--------------------------------+
| < Dune: Part Two        [edit] |
+--------------------------------+
| Near me · This week            |
| ( Just me )  ( Plan group* )   |
+--------------------------------+
| BEST NIGHT FOR THE GROUP       |
| +----------------------------+ |
| | Event George St · Wed 7:40 | |   <- ONE hero recommendation
| | Recliner · ▓▓▓▓░ · all 7   | |
| | Gets all 7 of you together | |   <- reason baked in, no lens choice
| | in good centre seats       | |
| | [ See seats & book »]      | |
| +----------------------------+ |
|                                |
| Other ways:                    |   <- alternatives, each tagged by the tradeoff it wins
| [ Bigger screen, 6 together> ] |
| [ Better seats, Tue        > ] |
| [ Soonest (5 of 7)         > ] |
+--------------------------------+
```
Annotations:
- No lens chips. The product **commits to one ranking** (in group mode: most-together + seat quality)
  and explains it; alternatives are escape hatches tagged by their tradeoff incl. fit tier.
- Lower cognitive load; the bet it tests is the opposite of C1's (A3). If users reach for the
  "other ways" tags constantly, that is evidence *for* C1.

---

## What the usability test will compare (Stage 10 preview)
Three tasks across the two concepts:
- **Solo:** "See a specific film this Saturday night with one other person. Find the option you'd
  actually book."
- **Organiser (unaided):** "You're organising friends to see this film this week. Show me what you'd
  do." — first metric is whether they even find the Plan-group path.
- **Organiser (directed):** "Get the most of your 6–7 friends to this film this week, sitting
  together. Find the night you'd lock in."

Watch:
- Do they understand **why** an option is top (C1 why-line vs C2 baked reason)?
- C1: do they use the lens chips (incl. Most together)? C2: do they fall back to "other ways" a lot?
- Persona toggle: is "Plan group" noticed unaided? Are the per-day steppers obvious?
- Do they trust the seat logic and the group-fit tier on Screen 2 (shared)?
- Is the handoff clear or a dead end?

## Open structure questions (before the Stage 9 prototype)
- How many candidate days does the group panel show by default, and does the organiser add/remove days?
- Is the **C1 card** carrying the right signals (cinema+day+time / format+seat-signal+fit / why-line),
  or is one missing (price, distance)?
- Where exactly is the Together / Nearby / Split boundary (how far apart is still "nearby")?
- Resolved this pass: slider → **per-day stepper**; organiser → **visible "Plan group" toggle**;
  turnout → **three-tier**; no "book if ≥ N" threshold for v1.
