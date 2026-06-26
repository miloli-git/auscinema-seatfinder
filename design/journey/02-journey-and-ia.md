# 02 · Journey Map + IA — Movie-Forward Reframe

First-diamond / early-Develop artifact. **Stage 4** (journey map) + **Stage 5** (information
architecture). Built on the locked frame in [01 · Framing Brief](./01-framing-brief.md). See the
[journey index](./README.md) for the full walk.

**Locked decisions this is built on:**
- Entry: **movie-first primary, "what's on" browse co-equal**.
- Decision model: **Tradeoff Chooser** (user picks what matters tonight), not a single imposed ranking.
- v1 lenses: **best seats left / best screen / soonest**. "Least crowded" **deferred**
  (availability-ratio proxy, least trustworthy — add once the core is validated).
- Context capture: **assumed defaults, skip straight to results** (near-me / tonight / 2 people),
  refine after. No up-front wizard.

Still lo-fi. No layout, no styling, no seat-map render. Boxes and arrows in prose.

## 4. Journey map

Goal arc: from **"I want to see this film"** (or "what's on near me?") to **booked on the official
page, confident I got the good version of this outing**. Two entry points converge fast.

| Step | User action | Thinking | Feeling | Pain we remove |
|---|---|---|---|---|
| 0a. Entry — movie-first | Names/searches the film they already decided on | "Where and when can I see *this*, done well?" | Decided, a bit impatient | No tool starts from the film across chains |
| 0b. Entry — browse | "What's on near me this week?" then picks a title | "Is there something worth going out for?" | Exploratory, open | Browse is per-chain and forgets seat quality |
| 1. Light context | Gives where (city/near me), when-ish (tonight / Sat / flexible), party size, seat preference | "Here's roughly my night" | Cooperative if it's quick | Status quo makes you re-enter this on every chain site |
| 2. See best ways to see it | Reads a small set of recommended sessions, each labelled by tradeoff | "Which of these is *my* best night?" | Relief if the tradeoffs are legible; overwhelmed if it's a raw list | The core reframe: tradeoffs surfaced, not a generic time list |
| 3. Pick the tradeoff that matters | Chooses a lens: best seats left / best screen / soonest | "Tonight I care most about good seats" | In control | No existing tool lets you sort by *why* |
| 4. Inspect one option | Opens a session: seat-quality view, availability confidence, what makes it good | "Are the good seats really still there? Do I trust this?" | Reassured or skeptical | Seat quality is invisible until you open each official map |
| 5. Handoff to booking | Clicks through to the official chain page for that exact session | "Now just complete it" | Confident, not abandoned | A clear handoff vs feeling dumped at a dead end |
| 6. Post (out of product) | Books on official site | "Sorted. Good seats." | Satisfied, planned a good night | — |

**Critical moments (where the experience is won or lost):**
- Step 2: do the tradeoff labels make sense at a glance, or is it just another list?
- Step 4: does the seat-quality confidence earn trust? (this is the whole differentiator)
- Step 5: does the handoff feel like a clean pass, not an abandonment?

**Edge paths to design for (not just the happy path):**
- No good seats left in any nearby session — product must say so honestly, not hide it.
- Film only showing far away / at bad times — surface the real constraint, don't fake options.
- Party-size seats-together impossible — flag before handoff, not after.
- Large-format only at one inconvenient cinema — present as an explicit tradeoff.

## 5. Information architecture

**What the user needs, in priority order (top = first thing on screen):**
1. The film (poster/title confirms "yes, this is what I'm choosing how to see").
2. My context controls: where, when-ish, party size, seat preference (light, editable, persistent).
3. The recommended ways to see it — a small ranked-by-chosen-tradeoff set, each with a one-line "why".
4. The tradeoff lens switcher (best seats / best screen / soonest).
5. Per-option detail on demand: seat-quality view + availability confidence + class/format.
6. The booking handoff (always visible once an option is chosen).
7. Cross-chain transparency (which chain/cinema each option is) — present but not the headline.

**Screen / surface inventory (lo-fi, names not layouts):**
- **Entry surface** — dual: film search (primary) + "what's on near me" browse (co-equal). Browse
  resolves to a title, then both paths join at the Context step. (The SOH direction = the browse surface.)
- **Context capture** — lightweight, inline, not a multi-step wizard. Defaults assumed (near me /
  tonight / 2 people) so a user can skip straight to results and refine after.
- **Best Ways view** (the heart) — the film + context summary + the tradeoff lens + the recommended
  sessions. This replaces today's generic ranked session list.
- **Option detail** — seat-quality map/representation, availability confidence, format/class, price
  signal, "best zones still open", handoff button.
- **Handoff** — deep link to the exact session on the official chain page.
- **Empty/honest states** — "no good seats nearby tonight", "only showing far / late", surfaced as
  first-class content, not errors.

**IA principle for the reframe:** the film is the constant context held at the top of every surface;
where/when/seat are *filters under it*, never the entry. The user should never feel they navigated
away from "seeing this film" — they are always resolving constraints beneath a fixed title.

**Maps to existing data/scoring (feasibility check, not new build):**
- "Best seats left" / seat-quality view = existing `seatQuality()` scorer + real layouts
  ([`../iterations/data/`](../iterations/data/); true geometry on Event/Reading/Village; Hoyts approximate).
- "Best screen" = auditorium class/format already known per session (Vmax / Xtremescreen / recliner / Gold).
- "Least crowded" = availability ratio from the seat map (proxy, label as estimate; deferred for v1).
- "Soonest" / "best time" = session times already pulled per chain.
- Cross-chain = the 4 live adapters already unify this; the reframe is presentation, the data exists.

## Next stages
- Stage 6 — User flows: happy path, comparison path, no-good-seats path, handoff path (boxes/arrows).
- Stage 7 — Divergent concepts, led by the Tradeoff Chooser, with Best-Option-First and Film Night
  Planner as alternates. This is where the visual directions get reconciled into the reframed flow.

## Decisions resolved
- **Lenses:** three for v1 — best seats left / best screen / soonest. "Least crowded" deferred.
- **Context:** assumed defaults, skip to results, refine after.

Flows + divergent concepts built on this in [03 · Flows + Concepts](./03-flows-and-concepts.md).
