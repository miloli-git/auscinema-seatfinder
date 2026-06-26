# 01 · Framing Brief — Movie-Forward Reframe

First-diamond artifact (Discover / Define). **Stage 1** (frame the challenge) + **Stage 3** (JTBD).
This is a problem-definition document, not a design. Nothing here is styled or wireframed yet — that
is deliberate. Validate the framing before anything downstream is built on it.

See the [journey index](./README.md) for how this fits the Double Diamond.

## Summary
The current product is **cinema-forward / time-forward**: it hands the user a ranked list of
sessions and makes them do the wrapping ("which of these actually gets me a good night?"). The
reframe is **movie-forward**: the user already knows the film, and the job is to find the best
real-world *way to see it* — session, screen, seat, timing — and hand off to booking with
confidence. There are two co-primary users: a solo/fixed-party booker, and a **group organiser**
coordinating a flexible group whose attendance varies by day. This brief defines that problem
sharply so the next stages (journey, IA, flows, concepts) solve the right thing.

## 1. Frame the design challenge

**Target user — two, co-primary.** Both have *already decided what film*; they are choosing how,
where and when to see a known title, not browsing.
1. **Solo / fixed party** — booking for themselves or a locked small group (partner, family).
2. **Group organiser** — coordinating a *flexible* group whose attendance is **not locked and varies
   by day** (e.g. 6 keen for Tuesday, 7 for Wednesday). They pick the session partly on how many of
   their people can make it. The solo user is the N=1 case of this.

Both are in a specific city, with some date/time flexibility but real constraints.

**Situation.** They want to see a specific film in the next few days. Multiple chains and cinemas
near them are showing it, across many session times, in different auditorium classes (standard,
recliner, Gold, Vmax/Xtremescreen large-format), with different seat availability and quality. For
an organiser, headcount is **day-dependent** — the set of people who can attend differs by
session/day, so "party size" is not one fixed number.

**Current workaround (the status quo we are beating).**
- Open each chain's site/app separately (Event, Hoyts, Reading, Village), search the film, eyeball
  times, then open the seat map for promising sessions one at a time to judge whether good seats
  remain.
- No cross-chain view. No way to compare "best seats left" across sessions. Seat quality is judged
  by eye on each official map. Large-format vs standard is buried in session labels.
- An organiser also juggles *who can make which day* in their head (or a group chat) against where
  the good seats are. Nothing weighs turnout and seat quality together.
- Our *own current UI* partially solves the solo case but still presents the solution shape (a ranked
  list of sessions) and leaves the "which of these is actually my best night?" reasoning to the user.

**Pain (what makes the status quo bad).**
- High manual comparison cost across chains, sessions, and seat maps.
- Seat *quality* is invisible until you open each map; "available" != "worth sitting in".
- Tradeoffs that actually decide the choice (great screen vs great seats vs convenient time vs
  turnout) are never surfaced side by side.
- For a group: no way to weigh *which session gets the most of my flexible group into good seats
  together* — the organiser does this by hand across a chat and several booking sites.
- Decision anxiety: "if I book this one, am I missing a better option I did not check?"

**Desired outcome.** The user names the film, gives light context (where, when-ish, party size — or,
for an organiser, the day-by-day headcount of a flexible group — and seat preference), and is shown
the **best ways to see this film**, each explaining its tradeoff, with seat-quality confidence, then
handed to official booking. They book once, confidently, without manually comparing every cinema.

**Problem statement.**
> For someone who already knows the film they want to see, choosing the best real-world way to see
> it (cinema, session, screen, seat, timing) currently requires manual cross-chain comparison and
> per-session seat-map inspection. There is no single view that starts from the film and surfaces
> the genuinely best options with their tradeoffs and seat confidence. For a group organiser the
> problem compounds: attendance varies by day, so the "best" session also depends on how many of a
> flexible group can make it — and no tool weighs turnout and seat quality together.

## 2. Scope and non-goals (for this reframe)
- **In scope:** the entry point and decision model — starting from a film and resolving where/when/
  which-seat *under* it; surfacing tradeoffs; seat-quality confidence; an organiser weighing
  day-dependent turnout (entered by the page user); clean handoff to official booking.
- **Out of scope (still true product constraints):** no in-app booking or payment (handoff only);
  no recommendation of *what* to watch (user arrives with a title); no new chains beyond the 4 live
  adapters; auth stays at the proxy layer; **no group-availability collection / RSVP / shareable
  poll** — the organiser inputs the headcount themselves; building the multi-user coordination layer
  is a separate, bigger product.
- **Not a styling exercise.** Palette, colour scale, seat-map render, and the SOH landing are
  downstream (second-diamond) and only get touched once the flow is validated.

## 3. JTBD synthesis (draft — assumption-based, see warning)

**Primary job — solo / fixed party (functional).**
> When I have already decided to see a specific film, help me find the session and seat that make it
> feel worth going out for, so I can book confidently without comparing every cinema myself.

**Primary job — group organiser (functional).**
> When I'm organising a group whose availability differs by day, help me find the session that gets
> the most of my people into good seats together, so I can lock a night that actually works for the
> group.

**Emotional job.** Feel that I got the *good* version of this outing (great screen, good seats, right
time, the right people there) and that I did not miss a better option I failed to check.

**Social job.** Look like I planned a good night for the people I am bringing; not strand anyone with
a bad seat, a worse session, or a night half the group can't make.

**Decision criteria the product must let people weigh (hypothesis, to validate):**
1. Seat quality / availability of good seats.
2. Screen format and auditorium class (large-format, recliner, Gold).
3. Session time (e.g. "best time after work", not too late).
4. Travel / which cinema (distance, parking, familiarity).
5. Crowding (quietest likely session).
6. Price (class-dependent).
7. Party constraints (N seats together, accessibility).
8. **Turnout** — how many of a flexible group can attend this session/day (organiser only).

The reframe's bet: **most users do not rank these the same way, so the product should let the user
pick the tradeoff that matters tonight rather than imposing one global ranking.**

## 4. Key assumptions to validate (the honest part)
The real moviegoer-interview research was not run for this first pass (solo side project, no panel).
Everything in section 3 and the decision criteria is **reasoned assumption, not validated research.**
Flagging explicitly so we do not treat it as fact:

- A1. ~~Users arrive already knowing the film.~~ **DECIDED:** movie-first is the *primary* entry, but
  "what's on" browse is **co-equal**, not secondary. The SOH "What's On" landing stays a first-class
  entry, not a side branch. Still worth validating which entry dominates by volume.
- A2. Seat quality is a real, felt decision input — not just availability. *Core to the whole product.*
- A3. ~~Users want to weigh tradeoffs themselves vs trust one "best" answer.~~ **DECIDED:** build the
  core flow around the **Tradeoff Chooser** (user picks what matters tonight: best screen / best
  seats / soonest). Best-Option-First is kept as a possible secondary concept, not the spine.
- A4. Cross-chain comparison is genuinely painful enough to switch tools for. *Decides if the cross-
  chain promise is the wedge or a nice-to-have.*
- A5. The official-booking handoff is acceptable, not a dealbreaker ("why not just book here?").
- A6. ~~Party size is a single fixed input.~~ **DECIDED:** group attendance is often **not locked and
  varies by day** (6 Tue / 7 Wed), and the **organiser is a co-primary persona** (solo = N=1).
  Handled by **organiser input** — the page user enters the day-dependent headcount themselves and the
  product weighs it. **Out of scope:** collecting availability from the group (RSVP / shareable poll),
  which would make it a multi-user coordination tool. Implies a candidate new tradeoff lens **"best
  turnout"** (open: we locked 3 v1 lenses — best seats / best screen / soonest — so turnout would
  make it 4, or replace one) and a **day-dependent seats-together block size**.

**Cheapest validation (later):** the 5 discovery questions ("tell me about the last time you chose a
movie session...", and for groups "...the last time you organised people for a movie") with 5 to 8
people, plus 3 competitor walkthroughs. Until then, downstream work is built on assumptions and
labelled as such.

## 5. What this unlocks (next stages)
- Stage 4 — Journey map: "I want to see this film" to official booking handoff.
- Stage 5 — Information architecture: what the user needs first (film, nearby sessions, seat quality,
  constraints, handoff).
- Stage 6 — User flows: happy path, comparison path, unavailable-seat path, handoff path.
- Stage 7 — Divergent concepts: Best Option First, Tradeoff Chooser, Film Night Planner, Seat
  Confidence View (second-diamond / Develop).

**Downstream impact of the organiser persona (A6).** The journey, IA, flows and wireframes were
drafted solo-first and now need an organiser-first revision: day-dependent headcount in context
capture, a candidate **"best turnout"** lens, a **day-dependent seats-together** block size, and a
**"fits 6 of your 7" honest state**. Open decision before that revision: does "best turnout" join the
v1 lens set (making 4) or replace one of the locked three?

## Decisions resolved
- **Entry (A1):** movie-first primary, "what's on" browse co-equal. SOH landing kept as first-class entry.
- **Decision model (A3):** Tradeoff Chooser is the spine; Best-Option-First demoted to a contrast concept.
- **Group availability (A6):** organiser is co-primary; day-dependent headcount entered by the organiser;
  no group RSVP/coordination layer.

Journey map + IA built on this in [02 · Journey Map + IA](./02-journey-and-ia.md).
