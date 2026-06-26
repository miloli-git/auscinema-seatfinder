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

Both share the entry, the group panel, and the option-detail screen, so the test isolates the
**decision model** itself. Both serve two personas: a **solo** user (defaults, skips straight to
results) and a **group organiser** (opens a group panel, sets per-day headcount).

Legend: `[ ]` button/chip · `( )` toggle · `____` input · `[——●——]` slider · `▓` grayscale map cell · `»` handoff.

---

## Shared — Screen 0: Entry

Skip-to-results means entry is minimal; defaults do the work. Group mode is **not** chosen here — it
is opened later from the context bar (progressive disclosure), so the solo path stays one tap to results.

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

## Shared — Screen 0b: Group panel (organiser only, opened from the context bar)

Revealed when the user taps "+ group" on the context bar. The per-day headcount sliders are the one
input an organiser can't be defaulted into (counts vary by day). Solo users never see this.

```
+--------------------------------+
| < Dune: Part Two        [edit] |
+--------------------------------+
| Near me · This week · Group  ^ |   <- context bar, group section expanded
+--------------------------------+
| Who's keen, by day?            |
|                                |
|  Tue 24   [———●————]  6        |   <- one headcount slider per candidate day
|  Wed 25   [————●———]  7        |
|  Thu 25   [—●——————]  4        |
|  Fri 26   [————————]  0        |   <- 0 = nobody / skip that day
|                                |
| [ Show best ways for the group]|
+--------------------------------+
```
Annotations:
- One slider per candidate day; drag sets how many are keen. Days at 0 drop out.
- Sets the headcount that "best turnout" and the group-fit count read against, per day.
- Open question for the test: is a slider the right control, or steppers / quick-pick chips? Does the
  day list auto-populate from "this week" or does the organiser add days?

---

## C1 — Screen 1: Best Ways view (the heart)

Group mode shown (a 4th lens chip appears, cards gain a group-fit count). Solo mode = identical minus
the turnout chip and the fit count.

```
+--------------------------------+
| < Dune: Part Two        [edit] |   <- film pinned as fixed context (title = constant)
+--------------------------------+
| Near me · This week · 6-7  + group ^  <- context summary; group set, tap to edit sliders
+--------------------------------+
| What matters?                  |
| [Best seats][Screen][Soon][Turnout]*  <- LENS CHIPS; Turnout shows only in group mode
+--------------------------------+
| TOP FOR BEST TURNOUT           |   <- section label reflects active lens
| +----------------------------+ |
| | Event George St · Wed 7:40 | |   <- session card (day shown, counts vary by day)
| | Recliner · ▓▓▓▓░ · all 7   | |   <- seat signal + group-fit count
| | Why: all 7 together, centre | |   <- one-line "why" tied to active lens
| +----------------------------+ |
| +----------------------------+ |
| | Hoyts EQ · Tue 8:15        | |
| | Standard · ▓▓▓░░ · all 6   | |
| | Why: whole Tue group fits   | |
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
- In group mode each card shows the **group-fit count** for that session's day ("all 7" / "5 of 7").
- Card hierarchy: cinema+day+time (scan), format+seat-signal+fit (judge), why-line (trust). Tap = Screen 2.
- Cross-chain present (cinema name) but not the headline.

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
| Best night for all 7: Tue 8:15 |   <- the day/session where the whole group fits
| Tonight only fits 6 of your 7  |
| [ See Tue 8:15 — all 7 fit  »] |
| [ Book tonight for 6        »] |   <- both real moves offered, product doesn't pick silently
```

---

## Shared — Screen 2: Option detail (seat-quality view)

Same for C1 and C2 so the test isolates the decision model, not the detail screen. Group-fit line
appears in group mode.

```
+--------------------------------+
| < Event George St · Wed 7:40   |
+--------------------------------+
| Dune: Part Two · Recliner      |
| Good seats likely until ~7:10  |   <- availability confidence (the trust line)
| All 7 together: yes (rows D-E)  |   <- group-fit (group mode only)
+--------------------------------+
|        S C R E E N             |
|   ▓▓ ▓▓ ▓▓ ▓▓ ▓▓ ▓▓ ▓▓         |   <- seat-quality map, grayscale heat (darker = better)
|   ▓▓ ██ ██ ██ ██ ▓▓ ▓▓         |      (██ = best zone; real geometry from captured layouts)
|   ░░ ██ ██ ██ ██ ░░ ░░         |
|   ░░ ░░ ▓▓ ▓▓ ░░ ░░ ░░         |
|                                |
|  Best zones still open: centre |   <- plain-language readout of the map
|  rows D-F. 7 adjacent: rows D-E |   <- party / group adjacency checked BEFORE handoff
+--------------------------------+
| [ » Book on Event official ]   |   <- handoff, always visible once option chosen
+--------------------------------+
```
Annotations:
- Seat map leads with **meaning** (best zones / can-the-group-sit-together), not raw availability.
- "Turnout" is defined as the largest **adjacent** block, so the fit line names actual rows.
- The map is the one place the chosen visual direction lands in the second diamond.
- Handoff carries cinema + session + shown-seats so the official page feels like a continuation.

---

## C2 — Screen 1: Best Option First (the contrast)

Same entry (Screen 0), group panel (Screen 0b) and option detail (Screen 2). Only the decision screen
differs.

```
+--------------------------------+
| < Dune: Part Two        [edit] |
+--------------------------------+
| Near me · This week · 6-7  + group ^ |
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
| [ Bigger screen, fits 6   > ]  |
| [ Better seats, Tue       > ]  |
| [ Soonest (fits 5)        > ]  |
+--------------------------------+
```
Annotations:
- No lens chips. The product **commits to one ranking** (in group mode: best turnout + seats) and
  explains it; alternatives are escape hatches tagged by their tradeoff incl. fit count.
- Lower cognitive load; the bet it tests is the opposite of C1's (A3). If users reach for the
  "other ways" tags constantly, that is evidence *for* C1.

---

## What the usability test will compare (Stage 10 preview)
Two tasks, same on both concepts:
- **Solo:** "See a specific film this Saturday night with one other person. Find the option you'd
  actually book."
- **Organiser:** "Get the most of your 6–7 friends to this film this week, sitting together. Find the
  night you'd lock in."

Watch:
- Do they understand **why** an option is top (C1 why-line vs C2 baked reason)?
- C1: do they use the lens chips (incl. Turnout)? C2: do they fall back to "other ways" a lot?
- Group panel: is "+ group" / the per-day sliders obvious, or missed?
- Do they trust the seat logic and the group-fit count on Screen 2 (shared)?
- Is the handoff clear or a dead end?

## Open structure questions (before the Stage 9 prototype)
- Is the per-day **slider** the right headcount control, or steppers / quick-pick chips? Does the day
  list auto-populate or does the organiser add days?
- Is the **C1 card** carrying the right signals (cinema+day+time / format+seat-signal+fit / why-line),
  or is one missing (price, distance)?
- Is the **shared Screen 2** the right level of seat + group-fit detail for a first test?
- Anything in the **no-good-seats / partial-group** states to frame differently?
