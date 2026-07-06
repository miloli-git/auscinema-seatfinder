# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).

## [1.0.0] — 2026-07-06

First complete release, formally accepted against the canonical live test: the page and the
lead-time CLI independently agree on the earliest date a qualifying seat pair exists for
The Odyssey at IMAX Sydney.

### Chains and data
- Adapters for all four AU chains — Event, Hoyts, Reading, Village — each against the chain's own
  open JSON endpoints, no auth (#1–#8). True row/column geometry everywhere except Hoyts
  (index-based, flagged approximate in the UI, #52/#66).
- Sydney IMAX confirmed end-to-end via the Event adapter, including a lead-time / pair-availability
  finder CLI (#49/#58).
- Postgres session/seat cache ("Seats Together" ST-1/ST-2/ST-3, #26–#28): scored available seats
  stored per session, party size and minimum score tunable at query time.
- Rolling cache horizon with far-future first-ingest (#60/#62), tier-aware refresh with
  proximity-weighted due-selection and per-chain budgets (#46/#85), tier-aware staleness gating
  (#87), zombie-session tombstoning with debounce (#77/#78), scheduled Event cinema-snapshot
  refresh + CI (#51/#63), dead-man alerting (#64/#65).
- Name-quality hardening: blank-name healing from refresh discovery (#67/#72/#75), comma-joined
  Hoyts vistaId splitting (#79), DB query fix so blank names can never outrank real ones, with a
  web-side "never render a raw id" fallback (#84/#88).

### Seat quality
- Geometric seat scoring (0–100): row depth vs ideal viewing position and centrality, normalised
  per auditorium; 5-step heatmap ramp; top-N best-pick highlights.
- Adjacent-block finder for parties (together / nearby / split fit tiers).

### Product
- Movie-forward UX (the #47 reframe, built through a documented Double-Diamond process in
  `design/journey/`): movie list entry, tradeoff lenses (best seats / best screen / soonest /
  most together), group organiser mode with per-day headcounts (#80/#82), date-availability strip
  with honest freshness/coverage copy (#73/#74), centre-stage seat map, direction G
  (Glossier × Sydney Opera House) visual system (#83).
- Large-format badges (IMAX / V-Max / Xtremescreen) + large-format-only filter (#50/#56).
- Booking handoff deep-links live-verified on all four chains, including cold-load fixes for
  Reading (#53/#68).

### Infrastructure
- Fastify API + Vite/React web app, Docker Compose deploy behind Caddy on NAS, published at
  seatfinder.miloli.org; per-IP rate limiting protecting upstream chain endpoints (#9).
- CI: workspace tests + the web app's exact Docker typecheck (#71).

[1.0.0]: https://github.com/miloli-git/auscinema-seatfinder/releases/tag/v1.0.0
