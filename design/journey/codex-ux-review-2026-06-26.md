# Codex UX Review — Movie-Forward Reframe (2026-06-26)

Independent UX review (Codex / gpt-5.5) of the organiser persona + turnout changes. Drove the slider→stepper, visible-mode, three-tier-turnout, and copy decisions recorded in the journey docs.

## 1. Organiser Flow

The progressive-disclosure model is directionally right for protecting the solo path, but it is currently under-specified for a supposedly co-primary organiser.

The contradiction is this: the docs call the organiser co-primary, but the wireframe makes them discover themselves through `+ group` after landing in solo-default results. That can work only if `+ group` has strong information scent. As drawn, it risks reading as an add-on, not a primary mode.

Failure modes:

- An organiser misses `+ group`, sees solo-biased results, and assumes the product does not support flexible groups.
- Results re-rank after group input, which may make the initial recommendations feel disposable or untrustworthy.
- `+ group` is vague. It could mean group booking, discounts, shared planning, or RSVP.
- “Who’s keen, by day?” implies the product might collect availability, which is explicitly out of scope.
- The turnout lens appearing only after group setup is logical, but it hides a major value proposition until after the user has already understood the product.

Better framing: keep solo as the default, but make the organiser path visible in the context bar as a clear mode: `2 people` / `Plan flexible group`. That preserves skip-to-results while making group planning feel first-class.

## 2. “Best Turnout” Lens

The core definition is useful: turnout should not mean “tickets exist”; it should mean “how many can sit together.” That is the right honesty bar.

But the current definition is too blunt.

`largest adjacent block` is sound only if adjacency is rigorously defined and trustworthy. Current issues:

- If 7 seats exist as `4 + 3` split across a row, the product should not call that “all 7 together.”
- If seats are across rows D-E, that is not obviously “adjacent” in the user’s mental model. It may be “nearby,” not “together.”
- Recliner houses often have short rows, paired seats, aisles, blocked companion seats, and odd geometry. A simple largest-block count can mislead.
- Hoyts approximate geometry makes “all 7 together” too confident. It should become “likely together” or carry lower-confidence treatment.
- A “turnout” rank can accidentally prefer 7 bad front-row seats over 6 excellent centre seats. The lens needs a tie-breaker or visible caveat: `all 7 together, fair seats` versus `6 together, excellent seats`.
- Day-level headcount ignores time-level availability. “7 Wednesday” may not mean 7 can do both 6:10pm and 9:20pm.

I would split the model into three labels:

- `Together`: contiguous same-row block.
- `Nearby`: split but close, such as adjacent rows or split pairs.
- `Split`: available seats exist, but the group is fragmented.

Then rank “best turnout” by `together count`, with seat quality and confidence as secondary sort keys.

## 3. Per-Day Headcount Slider

I would not ship sliders for this.

A slider is the wrong control for small integer headcount. It implies continuous precision, is fiddly on mobile, is weaker for accessibility, and becomes noisy when repeated across days. More importantly, it falsely asks for exactness when the organiser may only know “around 6,” “maybe 7,” or “at least 5 or it is not worth it.”

It also hides a deeper modelling problem: `6 Tue / 7 Wed` does not say whether those are the same people, whether one person is essential, whether two couples need to sit together, or whether the Wednesday 7 includes people who are only tentative. A count is useful, but it is a lossy proxy.

Realistic alternatives:

| Input model | Optimises for | Cost |
|---|---|---|
| Per-day steppers | Precise small integers, compact mobile layout, accessible controls | Slower if starting from zero; still forces exact counts |
| Per-day number chips | Fast selection for small groups; clearer than sliders | Takes horizontal space; awkward above 8-10 people |
| Per-day `ideal / minimum` counts | Captures uncertainty: “ideally 7, book if 5+” | More complex scoring and harder copy |
| People-by-day matrix | Captures overlap, must-have people, real “who is excluded” consequences | Heavy setup; begins to feel like RSVP software |
| Lightweight roster with day ticks | Good for repeat friend groups; organiser still inputs everything | Names/privacy friction; slower than this product probably wants |
| Calendar availability view | Best for many dates/times | Strongly implies polling/coordination; too big for v1 |
| Parse/import group chat | Lowest manual input in theory | Privacy, permissions, parsing errors, high implementation cost |
| Single max party size + flexible days | Fastest and simplest | Fails the stated day-dependent problem; blunt ranking |

The best v1 compromise is not a slider. Use per-day rows with integer controls: a compact stepper or number chip picker, plus an optional `minimum worth booking` threshold. Example:

`Tue 24 · ideal 6 · book if 5+`

That better matches how organisers think: not just “how many,” but “what count makes this night acceptable?”

## 4. Other UX Risks

The lens row is getting dense. Four chips on mobile can work, but `Best seats`, `Screen`, `Soon`, `Turnout` may become a row of jargon. “Turnout” especially may read as popularity/crowding. Consider `Most together` or `Best for group`.

The `fits 6 of 7` state is honest, but the wording is dangerous. It can sound like only 6 people can attend, when the actual issue may be that only 6 can sit together. Use `6 of 7 together` or `7 seats, split group`.

The current group panel copy points toward RSVP: “Who’s keen?” That invites the user to wonder where the sharing/polling feature is. Use `Estimated group size by day` or `How many are likely each day?`

The two-persona test plan needs sharper separation. If the organiser task tells participants “get the most of your 6-7 friends,” it may lead them to hunt for group features. Include an unaided version: “You’re organising friends for this film this week. Show me what you’d do.” The first success metric is whether they notice the group path at all.

## Recommendation

Replace the per-day sliders with compact per-day integer rows: steppers or number chips, with a clear `0 / skip day` state. If you keep one extra nuance, add `minimum worth booking` as a global or per-day threshold. Do not model a full roster in v1 unless testing shows organisers strongly need to know exactly who is excluded.

Prioritised changes:

1. Rename `+ group` to something with intent: `Plan flexible group` or `Group availability`.
2. Replace sliders with integer controls; avoid continuous drag for headcount.
3. Rename `Best turnout` to `Most together` or `Best for group`.
4. Distinguish `together`, `nearby`, and `split` in the seat logic and UI.
5. Add confidence treatment for approximate geometry, especially Hoyts.
6. Change `fits 6 of 7` to `6 of 7 together` and show the alternative: `all 7 split` or `all 7 together at Tue 8:15`.
7. Test organiser discoverability unaided before testing whether the ranking logic is understood.
