# 03 · Flows + Concepts — Movie-Forward Reframe

Closes the first diamond and opens the second. **Stage 6** (user flows) + **Stage 7** (divergent
concepts). Built on [01 · Framing Brief](./01-framing-brief.md) and
[02 · Journey Map + IA](./02-journey-and-ia.md). See the [journey index](./README.md) for the walk.

**Locked decisions carried in:**
- Entry: movie-first primary, browse co-equal (the SOH direction = browse surface).
- Decision model: Tradeoff Chooser.
- v1 lenses: best seats left / best screen / soonest (crowding deferred).
- Context: assumed defaults, skip to results, refine after.

Still lo-fi. Flows are boxes and arrows; concepts are described layouts, not styled mocks.

## 6. User flows

### 6a. Happy path (movie-first, the spine)
```mermaid
flowchart TD
  A["Search / name the film"] --> B["Results load instantly on assumed defaults:<br/>near me, tonight, 2 people"]
  B --> C["Best Ways view: small set of sessions,<br/>ranked by default lens 'best seats left'"]
  C --> D{"Refine?"}
  D -->|no| E["Open the top option"]
  D -->|yes| F["Adjust context inline<br/>or switch tradeoff lens"]
  F --> C
  E --> G["Option detail: seat-quality view +<br/>availability confidence + format/class"]
  G --> H{"Trust it?"}
  H -->|yes| I["Handoff to official booking page<br/>for this exact session"]
  H -->|no| C
```

### 6b. Browse entry (co-equal, resolves into the spine)
```mermaid
flowchart TD
  A["'What's on near me?' landing"] --> B["Browse titles showing nearby this week"]
  B --> C["Pick a title"]
  C --> D["Joins the movie-first spine at the<br/>Best Ways view, same defaults"]
```
Browse and movie-first **converge at the Best Ways view**. Browse never has its own results model;
it only resolves a title, then the rest is identical. Keeps one decision model, two doors.

### 6c. Lens-switch / comparison path (the reframe's signature)
```mermaid
flowchart LR
  A["Best Ways view"] --> B{"Which tradeoff<br/>matters tonight?"}
  B -->|best seats left| C["Re-rank sessions by seat-quality score"]
  B -->|best screen| D["Re-rank by format/class:<br/>Vmax / Xtremescreen / recliner / Gold"]
  B -->|soonest| E["Re-rank by start time"]
  C --> F["Same session set, re-ordered +<br/>re-labelled 'why this is top'"]
  D --> F
  E --> F
```
Switching a lens **re-ranks the same candidate set and changes the one-line "why"** on each option.
It does not reload or send the user elsewhere. This is the "let me weigh it my way" payoff.

### 6d. No-good-seats / honest-state path (designed, not an error)
```mermaid
flowchart TD
  A["Best Ways view"] --> B{"Any nearby session with<br/>good seats for the party?"}
  B -->|yes| C["Normal options"]
  B -->|no| D["Honest banner: 'No great seats left nearby tonight'"]
  D --> E["Offer the real tradeoffs explicitly"]
  E --> F["Later session same cinema /<br/>Further cinema, better seats /<br/>Different night"]
  F --> G["User picks a relaxed constraint"]
  G --> A
```
The product **says the truth and offers the next-best real move** rather than padding a list with
bad options. This is where trust is earned or lost (journey step 4).

### 6e. Handoff path
```mermaid
flowchart LR
  A["Chosen session + chosen seats-in-mind"] --> B["Deep link to the exact session<br/>on the official chain page"]
  B --> C["User completes booking on official site"]
```
Handoff carries enough context (cinema + session + the seats the user was shown) that the official
page feels like a continuation, not a restart. We never take payment.

## 7. Divergent concepts (3 to 5 lo-fi, Tradeoff Chooser led)

Avoid first-idea lock-in. Concept C1 is the chosen spine; C2 to C4 are genuine alternates kept cheap
so we test rather than assume. All are lo-fi layout descriptions, not styled.

### C1. Tradeoff Chooser (the spine — design this first)
- Film + light context summary pinned at the top (editable inline).
- A row of **lens chips**: [Best seats left] [Best screen] [Soonest]. One is active.
- Under it, a **short ranked list of session cards** (3 to 6), each: cinema + time + format, a
  seat-quality signal, and a one-line "why it's top for *this* lens".
- Tapping a card opens the **option detail** (seat-quality view + confidence + handoff).
- Strength: directly expresses the reframe's bet. Risk: lens chips must be instantly legible or it
  reads as just another sort dropdown.

### C2. Best Option First (alternate — lower load)
- One **hero recommendation**: "Your best way to see this tonight" with the reason baked in.
- Below it, 2 to 3 **alternatives** each tagged with the tradeoff they win ("better seats, later",
  "bigger screen, further").
- Strength: minimal cognitive load, confident. Risk: imposes one ranking; weaker if users really do
  weigh differently (A3). Good control to test C1 against.

### C3. Film Night Planner (alternate — conversational entry)
- A single editable sentence: "See **[film]** **[tonight]** near **[me]** with **[2]**, I care most
  about **[good seats]**." Each bracket is a tap-to-change token.
- Submitting resolves straight into the Best Ways view.
- Strength: makes the movie-forward mental model explicit and human; great for the browse-curious.
  Risk: sentence builders can feel gimmicky if the tokens are fiddly on mobile.

### C4. Seat Confidence View (alternate — seat-quality forward)
- Session cards that **lead with the seat-quality map thumbnail + a confidence line** ("good seats
  likely until ~30 min before") rather than time-first.
- Strength: pushes the true differentiator (seat quality) to the front. Risk: heavier per card; can
  overwhelm when scanning many sessions.

### Direction reconciliation (visual, for the second diamond)
- **The Glossier × SOH direction** (real Event recliner layout) = the visual language for the
  **option detail / seat-quality view** in every concept.
- **The SOH "What's On" direction** = the **browse entry** surface (6b), now a first-class door.
- The reframe's job in the second diamond: pour C1's structure into that visual system, with the
  browse landing as the alternate entry. The seven-direction gallery becomes *evidence of
  exploration*, not the product.

## Where the first diamond ends
This is the boundary. Next is **second diamond / Develop**:
- Stage 8 — Wireframes (grayscale, mobile-first) of C1, plus quick frames of C2 for testing.
- Stage 9 — Prototype the critical path (film → Best Ways → lens switch → option detail → handoff).
- Stage 10 — Usability test task: "You want to see a specific film this Saturday night with one other
  person. Find the option you would actually book." Watch for: do they understand *why* an option is
  top; do they trust the seat logic; do they feel forced to compare manually; is the handoff clear.

## Decision resolved
First diamond complete (frame → JTBD → journey → IA → flows → divergent concepts). Decision before
the second diamond: wireframe **C1 + C2** (Best Option First is the cleanest contrast) so the first
usability test compares two real decision models.

Wireframes built on this in [04 · Wireframes C1 + C2](./04-wireframes-c1-c2.md).
