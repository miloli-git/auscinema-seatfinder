VERDICT: NO-SHIP

## Findings

### HIGH - `REFRESH_HORIZON_DAYS >= 366` can crash every refresh tick before adapter-level isolation

- **File:line:** `packages/ingester/src/horizon.ts:27`, `packages/ingester/src/refresh.ts:411`, `packages/ingester/src/refresh.ts:468`, `packages/ingester/src/watches.ts:31`
- **Why this is a bug:** `resolveHorizonDays` accepts any positive integer, but `runLockedTick` feeds the resulting inclusive window directly into `datesInRange`. `datesInRange` hard-fails ranges over `MAX_RANGE_DAYS=366`; because the throw happens while constructing the `for (... of datesInRange(...))` iterable, it is outside the per-date `try/catch` and takes down the whole locked tick. This violates the #60 non-negotiable to respect `MAX_RANGE_DAYS` and turns an advertised config override into an outage. It also makes `/catalog` overstate the horizon for the same env value because the API uses the unbounded duplicate resolver and will still return the far future `horizonDate`.
- **Concrete repro/input:** set `REFRESH_HORIZON_DAYS=400` and run a tick with any enabled watch whose effective `from` is today or earlier. The pure repro is:

  ```sh
  node --experimental-strip-types -e "import { effectiveWindow, resolveHorizonDays } from './packages/ingester/src/horizon.ts'; import { datesInRange } from './packages/ingester/src/watches.ts'; const H = resolveHorizonDays({ REFRESH_HORIZON_DAYS: '400' }); const eff = effectiveWindow({ dateFrom: '2026-06-26', dateTo: '2026-07-26' }, '2026-06-29', H); console.log(JSON.stringify({ H, eff })); console.log(datesInRange(eff.from, eff.to).length);"
  ```

  It resolves `H=400`, `eff.to=2027-08-03`, then throws: `datesInRange: range 2026-06-29..2027-08-03 spans 401 days (> 366)`. `H=366` is already enough to fail in the common case because the range is inclusive (`today..today+366` = 367 dates).
- **Minimal fix:** define a shared maximum effective horizon of `MAX_RANGE_DAYS - 1` days (365 with the current inclusive helper) and clamp or reject above it at config resolution before discovery. Apply the same resolver/bounds to `/catalog` so `horizonDate` never advertises a window the ingester cannot scan.

## Areas Checked With No Separate Defect Found

- **Ledger invariant:** I do not see a reserve-lane counter bug. `sessionsDue` is the full due candidate count (`refresh.ts:593`, `refresh.ts:697`), reserved selections are included in `sel.selected` and flow through the same refresh/error counters as main-budget selections (`refresh.ts:623`, `refresh.ts:646`, `refresh.ts:650`), and `sessionsSkippedBudget` is exactly the aggregate drop set from `selectDueSessions` (`refresh.ts:245`, `refresh.ts:693`).
- **Reserve lane semantics:** I do not see a force-select or double-count bug for normal unique session ids. The reserved pass only sees already-due rows (`refresh.ts:210`), excludes reserved ids from the main pass (`refresh.ts:237`), and reports skipped as `ordered.filter(!selectedSet.has(id))` (`refresh.ts:245`). `reserveForNew:0` follows the legacy main slice path.
- **Rolling-window single source:** Discovery and `inScope` both read `windowFor` computed from `effectiveWindow` (`refresh.ts:412`, `refresh.ts:423`, `refresh.ts:466`), and `null` windows are skipped consistently.
- **`/catalog` SQL:** I do not see a `$N` indexing or injection bug in `maxCachedDate`: no-chain uses `date >= $1`; chain-scoped uses `chain = $1` and `date >= $2` with bound params (`packages/api/src/index.ts:795`). `NULL` max handling is explicit (`packages/api/src/index.ts:807`).
- **Load/politeness besides the horizon cap:** With sane config, per-chain seat-map fetches remain bounded by `budgetPerChain + reserveForNew` in `selectDueSessions`. The unbounded horizon override above is the real load/failure boundary defect I found.
