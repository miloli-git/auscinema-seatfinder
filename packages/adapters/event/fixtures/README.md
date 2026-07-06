# Event Cinemas fixtures

Captured live for offline tests. Movie 19797 (The Odyssey), cinema 58 (Burwood), date 2026-07-21.

- `getsessions.burwood.odyssey.json` - `/Cinemas/GetSessions` response
- `getseating.session-15433720.json` - `/Ticketing/Order/GetSeating?sessionId=15433720` response

Regenerate by re-running the two curls in the repo's session capture notes. Availability
fields will differ on recapture; geometry (SeatId row/col, areas) is stable.

## #90: IMAX Sydney front-section fixture

`getseating.imax-frontsection.json` - `/Ticketing/Order/GetSeating?sessionId=15428913`, IMAX
Sydney (cinema 96), captured 2026-07-06 (Moana [Live Action] was the live movie playing there at
capture time; the area/geometry structure is what matters, not the movie). The Burwood fixture
above has no front-section/box/couples areas, which is why #90 (front-section seats scoring as
"good") went uncaught by the existing tests.

Trimmed to rows A-D (front section, `StandardFront`/"Front Section View", plus `doublerec`/"Couples
Seat" in row D) and rows E, F, M, P, Q, R for back-of-house contrast (`club`/"Full Recliner" in M/P,
`boxpod`/"Coca-Cola Private Box" in R). Full `Areas` array preserved. Empty separator rows (no
`RowName`) were dropped as dead weight.
