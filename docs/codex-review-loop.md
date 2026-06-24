# Codex review loop

Purpose: Claude Code builds. Codex reviews at explicit checkpoints. Codex should not be treated as an always-on daemon because it cannot see Claude Code's in-memory session state. The control plane is a durable checkpoint packet written to this repo.

## Source of truth

Use this order:

1. The design or contract doc for the current feature.
2. `docs/session-log.md` for local build state and decisions.
3. The current branch diff.
4. `reviews/checkpoints/*.md` for Codex review packets.
5. GitHub issues for public tracking only.

GitHub issues are useful, but they are not always complete. Do not assume an issue comment contains the latest Claude Code context. Check `docs/session-log.md` and the checkpoint packet first.

## Checkpoint packet

At a review stop, Claude Code writes one packet under `reviews/checkpoints/` before asking Codex to review. The packet must include:

- task and issue number
- branch and base branch
- design or contract references
- changed files
- exact commands run
- test output or live evidence
- known gaps and assumptions
- specific review focus for Codex

Codex then reviews the packet, branch diff, and relevant files. It writes findings to `reviews/YYYY-MM-DD-<task>-codex-review.md`.

## Findings format

Codex reviews should lead with defects, not summary. Each finding needs:

- severity: `CRITICAL`, `HIGH`, `MEDIUM`, or `LOW`
- file and line
- concrete failure scenario
- suggested fix
- evidence reviewed

End with one verdict:

- `SHIP`
- `SHIP WITH FIXES`
- `DO NOT SHIP`

After Claude fixes anything non-trivial, run a second Codex review on the amended code. A fix is new logic and needs its own review.

## When to promote to GitHub

Promote to GitHub only when a finding should become public project tracking:

- `CRITICAL` or `HIGH`
- a follow-up that survives the current fix pass
- a product or deploy decision Milo should see outside local notes

Raw review files stay local in `reviews/`.

## Seats Together ST-2 focus

For the ingester checkpoint, Codex should focus on:

- per-session transactionality: delete plus insert cannot leave half-written seats
- idempotence: rerunning a watch does not duplicate rows or preserve stale seats
- failure isolation: one bad session or chain error does not poison the whole sweep
- DB semantics: available-only seats still preserve adjacency breaks
- ID namespace: session IDs cannot collide across chains
- politeness: concurrency caps, retry limits, and backoff around live chain calls
- evidence: manual run proves real adapter data reached Postgres
