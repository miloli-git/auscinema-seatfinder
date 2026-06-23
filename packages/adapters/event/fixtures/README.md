# Event Cinemas fixtures

Captured live for offline tests. Movie 19797 (The Odyssey), cinema 58 (Burwood), date 2026-07-21.

- `getsessions.burwood.odyssey.json` — `/Cinemas/GetSessions` response
- `getseating.session-15433720.json` — `/Ticketing/Order/GetSeating?sessionId=15433720` response

Regenerate by re-running the two curls in the repo's session capture notes. Availability
fields will differ on recapture; geometry (SeatId row/col, areas) is stable.
