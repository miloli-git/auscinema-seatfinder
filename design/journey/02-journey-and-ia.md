# 02 · Journey Map + IA — Movie-Forward Reframe

First-diamond / early-Develop artifact. **Stage 4** (journey map) + **Stage 5** (information
architecture). Built on the locked frame in [01 · Framing Brief](./01-framing-brief.md). See the
[journey index](./README.md) for the full walk.

**Locked decisions this is built on:**
- Two co-primary personas: **solo / fixed party** and **group organiser** (solo = N=1 of the organiser).
- Entry: **movie-first primary, "what's on" browse co-equal**.
- Decision model: **Tradeoff Chooser** (user picks what matters tonight), not a single imposed ranking.
- v1 lenses (4): **best seats left / best screen / soonest / most together**. "Least crowded" deferred.
- **Most together (turnout) = a three-tier group fit** for that day's headcount — Together (one block)
  / Nearby (split pairs, adjacent rows) / Split (fragmented). Coupled to seats-together, not just
  "can get a ticket"; rank by the *together* count with seat quality as tiebreaker.
- Context capture: solo gets **assumed defaults, skip straight to results**; a visible **"Plan group"
  mode** on the context bar reveals a **per-day headcount stepper** (small integers), because the
  organiser's counts vary by day and can't be defaulted.

Still lo-fi. No layout, no styling, no seat-map render. Boxes and arrows in prose.

## 4. Journey map

Goal arc: from **"I want to see this film"** (or "what's on near me?") to **booked on the official
page, confident I got the good version of this outing** — and, for an organiser, **the night most of
my group can actually make, together**. Two entry points converge fast; the organiser path adds a
light headcount step.

| Step | User action | Thinking | Feeling | Pain we remove |
|---|---|---|---|---|
| 0a. Entry — movie-first | Names/searches the film they already decided on | "Where and when can I see *this*, done well?" | Decided, a bit impatient | No tool starts from the film across chains |
| 0b. Entry — browse | "What's on near me this week?" then picks a title | "Is there something worth going out for?" | Exploratory, open | Browse is per-chain and forgets seat quality |
| 1. Light context | Solo: confirms/edits near-me, when-ish, party, seat pref (defaulted). **Organiser: sets per-day headcount** (stepper per candidate day — 6 Tue, 7 Wed) | "Here's roughly my night / who can come when" | Cooperative if it's quick | Status quo: re-enter on every chain site; no way to hold day-varying headcount at all |
| 2. See best ways to see it | Reads a small set of recommended sessions, each labelled by tradeoff (incl. turnout) | "Which of these is *my* best night / best for the group?" | Relief if the tradeoffs are legible; overwhelmed if it's a raw list | The core reframe: tradeoffs surfaced, not a generic time list |
| 3. Pick the tradeoff that matters | Chooses a lens: best seats / best screen / soonest / **most together** | "Tonight I care most about good seats" / "getting the most of us in together" | In control | No existing tool lets you sort by *why*, or by who can come |
| 4. Inspect one option | Opens a session: seat-quality view, availability confidence, **how many of the group fit together**, what makes it good | "Are the good seats really still there? Can all 7 sit together? Do I trust this?" | Reassured or skeptical | Seat quality + group-fit invisible until you open each official map |
| 5. Handoff to booking | Clicks through to the official chain page for that exact session | "Now just complete it" | Confident, not abandoned | A clear handoff vs feeling dumped at a dead end |
| 6. Post (out of product) | Books on official site | "Sorted. Good seats, right people." | Satisfied, planned a good night | — |

**Critical moments (where the experience is won or lost):**
- Step 1 (organiser): is setting day-by-day headcount fast and obvious, or a chore?
- Step 2: do the tradeoff labels (including turnout) make sense at a glance, or is it just another list?
- Step 4: does the seat-quality confidence *and the group-fit count* earn trust? (the differentiators)
- Step 5: does the handoff feel like a clean pass, not an abandonment?

**Edge paths to design for (not just the happy path):**
- No good seats left in any nearby session — product must say so honestly, not hide it.
- **Group can't all sit together** on a given day — say "6 of your 7 together here", name the
  day/session where all 7 do.
- Film only showing far away / at bad times — surface the real constraint, don't fake options.
- Most-together day and best-seats day disagree — present as an explicit tradeoff, do not silently pick.
- Large-format only at one inconvenient cinema — present as an explicit tradeoff.

## 5. Information architecture

**What the user needs, in priority order (top = first thing on screen):**
1. The film (poster/title confirms "yes, this is what I'm choosing how to see").
2. My context controls: where, when-ish, seat preference; party size for solo, **per-day headcount
   (steppers) for the organiser** (light, editable, persistent).
3. The recommended ways to see it — a small ranked-by-chosen-tradeoff set, each with a one-line "why".
4. The tradeoff lens switcher (best seats / best screen / soonest / **most together**).
5. Per-option detail on demand: seat-quality view + availability confidence + class/format + **how
   many of the group fit together**.
6. The booking handoff (always visible once an option is chosen).
7. Cross-chain transparency (which chain/cinema each option is) — present but not the headline.

**Screen / surface inventory (lo-fi, names not layouts):**
- **Entry surface** — dual: film search (primary) + "what's on near me" browse (co-equal). Browse
  resolves to a title, then both paths join at the Context step. (The SOH direction = the browse surface.)
- **Context capture** — lightweight, inline, not a multi-step wizard.
  - *Solo:* defaults assumed (near me / tonight / 2 people) so they skip straight to results and refine after.
  - *Organiser:* a visible **"Plan group"** toggle on the context bar opens a small panel of candidate
    days (those with screenings), each with a **headcount stepper** (how many likely that day). This is
    the one input the organiser can't skip, because the counts vary by day.
- **Best Ways view** (the heart) — the film + context summary + the tradeoff lens (4 chips) + the
  recommended sessions. This replaces today's generic ranked session list.
- **Option detail** — seat-quality map/representation, availability confidence, format/class, price
  signal, "best zones still open", **group-fit tier ("all 7 together" / "6 of 7 together")**, handoff button.
- **Handoff** — deep link to the exact session on the official chain page.
- **Empty/honest states** — "no good seats nearby tonight", "fits 6 of your 7 here", "only showing
  far / late", surfaced as first-class content, not errors.

**IA principle for the reframe:** the film is the constant context held at the top of every surface;
where/when/seat/who are *filters under it*, never the entry. The user should never feel they navigated
away from "seeing this film" — they are always resolving constraints beneath a fixed title.

**Maps to existing data/scoring (feasibility check, not new build):**
- "Best seats left" / seat-quality view = existing `seatQuality()` scorer + real layouts
  ([`../iterations/data/`](../iterations/data/); true geometry on Event/Reading/Village; Hoyts approximate).
- "Best screen" = auditorium class/format already known per session (Vmax / Xtremescreen / recliner / Gold).
- **"Most together"** = for a session's day, a three-tier group fit vs that day's headcount:
  **Together** (one contiguous block), **Nearby** (split pairs / adjacent rows), **Split** (fragmented).
  Rank by the *together* count, seat quality as tiebreaker. Needs true geometry to be reliable
  (Event/Reading/Village have it; Hoyts is array-order so adjacency is approximate — mark lower confidence).
- "Soonest" / "best time" = session times already pulled per chain.
- Cross-chain = the 4 live adapters already unify this; the reframe is presentation, the data exists.

## Next stages
- Stage 6 — User flows: happy path (solo + organiser), comparison/lens path, no-good-seats /
  partial-group path, handoff path (boxes/arrows).
- Stage 7 — Divergent concepts, led by the Tradeoff Chooser, with Best-Option-First and Film Night
  Planner as alternates. This is where the visual directions get reconciled into the reframed flow.

## Decisions resolved
- **Lenses:** four for v1 — best seats left / best screen / soonest / most together. "Least crowded" deferred.
- **Most together (turnout):** three-tier fit (Together / Nearby / Split) for the day's headcount.
- **Context:** solo defaults + skip-to-results; organiser sets per-day headcount steppers.

Flows + divergent concepts built on this in [03 · Flows + Concepts](./03-flows-and-concepts.md).
