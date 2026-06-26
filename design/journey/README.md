# Design Journey — Movie-Forward Reframe

This folder documents the design *process* behind the movie-forward reframe of AusCinema Seat
Finder, run as a deliberate [Double Diamond](https://www.designcouncil.org.uk/our-resources/the-double-diamond/)
cycle: understand the real problem, define it sharply, explore solutions, then deliver. Lo-fi
throughout — no polished mocks until the structure is validated.

It is the *why* that precedes the locked [`../DESIGN.md`](../DESIGN.md) spec and the seven visual
[`../iterations/`](../iterations/). The polished public presentation of the exploration lives in the
[case study](https://miloli-git.github.io/auscinema-seatfinder/case-study.html); this folder is the
"show your work" record behind it.

## The reframe in one line

Flip the product from **cinema/time-forward** (here is a ranked list of sessions, you do the
wrapping) to **movie-forward**: the user already knows the film, and the job is to find the best
real-world *way to see it* — cinema, session, screen, seat, timing — then hand off to official
booking with confidence. Two co-primary users: a solo/fixed-party booker, and a **group organiser**
coordinating a flexible group whose attendance varies by day.

## The walk (read in order)

| Stage | Doc | Double Diamond |
|---|---|---|
| 1 + 3 | [01 · Framing Brief](./01-framing-brief.md) — problem statement, JTBD, assumptions | Discover / Define |
| 4 + 5 | [02 · Journey Map + IA](./02-journey-and-ia.md) — journey, information architecture | Define |
| 6 + 7 | [03 · Flows + Concepts](./03-flows-and-concepts.md) — 5 user flows, 4 divergent concepts | Define → Develop |
| 8 | [04 · Wireframes C1 + C2](./04-wireframes-c1-c2.md) — grayscale, mobile-first | Develop |

Next (not yet in this folder): Stage 9 grayscale clickable prototype of the C1 + C2 critical path,
then a Stage 10 five-user usability test.

## Decisions locked along the way

- **Entry:** movie-first is primary, but "what's on" browse is **co-equal** (keeps the Sydney Opera
  House "What's On" direction as a first-class door, not a side branch).
- **Decision model:** a **Tradeoff Chooser** — the user picks the tradeoff that matters tonight —
  rather than one globally imposed ranking. (Best-Option-First is kept as a contrast concept, C2.)
- **v1 lenses:** best seats left / best screen / soonest. "Least crowded" deferred (it is only an
  availability-ratio proxy, the least trustworthy signal).
- **Context capture:** assumed defaults (near me / tonight / 2 people), skip straight to results,
  refine after. No up-front wizard.
- **Group availability:** the **organiser is a co-primary persona** (solo = N=1). Group attendance is
  often not locked and varies by day (6 Tue / 7 Wed); the organiser **inputs the day-dependent
  headcount themselves** and the product weighs turnout. No group RSVP / shareable-poll coordination
  layer (that is a separate, bigger product). Open: does a "best turnout" lens join the v1 set?

## Honesty note

The user research stage (interview 5–8 moviegoers, walk competitor flows) was **not** run for this
first pass — this is a solo side project. So the JTBD and decision criteria in the Framing Brief are
**reasoned assumptions, explicitly flagged as such**, not validated findings. They stay hypotheses
until the prototype is tested against real users. The process is sound; the inputs are still bets.

## Process reference

The spine is the Double Diamond, with Design Thinking as the mindset and Lean UX for shipping
discipline. Solo-builder stage sequence: frame → research → JTBD synthesis → journey map →
information architecture → user flows → divergent concepts → wireframes → prototype → usability test
→ visual system → build → measure. Sources: [Design Council — Double Diamond](https://www.designcouncil.org.uk/our-resources/the-double-diamond/),
[NN/g — Design Thinking 101](https://www.nngroup.com/articles/design-thinking/),
[Christensen Institute — Jobs to Be Done](https://www.christenseninstitute.org/theory/jobs-to-be-done/),
[NN/g — Why You Only Need to Test With 5 Users](https://www.nngroup.com/articles/why-you-only-need-to-test-with-5-users/).
