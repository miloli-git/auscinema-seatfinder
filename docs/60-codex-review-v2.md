VERDICT: SHIP-WITH-NOTES - the HIGH horizon crash/overstatement finding is resolved; no new ship-blocking clamp defect found.

## Resolution Check

### RESOLVED - `REFRESH_HORIZON_DAYS >= 366` no longer crashes the refresh tick or overstates `/catalog`

- **Files checked:** `packages/ingester/src/watches.ts:11`, `packages/ingester/src/horizon.ts:6`, `packages/ingester/src/horizon.ts:33`, `packages/ingester/src/horizon.ts:36`, `packages/api/src/index.ts:283`, `packages/api/src/index.ts:285`, `packages/api/src/index.ts:288`, `packages/api/src/index.ts:811`
- **Why resolved:** `MAX_RANGE_DAYS` is now exported from the ingester range helper and the ingester resolver clamps positive integer overrides with `Math.min(n, MAX_RANGE_DAYS - 1)`. With the current `MAX_RANGE_DAYS = 366`, `REFRESH_HORIZON_DAYS=400` and `366` both resolve to `365`, and `365` remains unchanged.
- **Inclusive-window check:** `effectiveWindow` uses `to = today + H`. At `H=365` and `from=today`, `datesInRange(today, today+365)` expands exactly `366` dates, which is accepted because `datesInRange` throws only when `days > MAX_RANGE_DAYS`. If a watch's `dateFrom` is later than `today`, `from` moves forward, so the range only shrinks; if it moves beyond `to`, `effectiveWindow` returns `null` before `datesInRange`.
- **API check:** `/catalog` now clamps its local resolver to `365`, so a huge env override no longer advertises a horizon beyond what the ingester can scan.

## New Defect Hunt

- **Off-by-one:** No defect found. The safe maximum horizon is exactly `MAX_RANGE_DAYS - 1` because the scanned date range is inclusive.
- **Default and normal overrides:** No regression found. Missing/invalid env still returns `DEFAULT_HORIZON_DAYS = 35`; a normal positive override like `60` remains `60`; boundary `365` remains `365`.
- **NaN/type coercion/new throw paths:** No new throw path found in the resolver. The coercion gate remains `Number.isInteger(n) && n > 0`, so `NaN`, empty string, zero, negatives, decimals, and infinities fall back to the default.
- **Resolver drift:** Non-blocking maintenance risk. The ingester uses `MAX_RANGE_DAYS - 1`, while API hard-codes `MAX_HORIZON_DAYS = 365`. The API comment clearly documents the lockstep requirement and why it is duplicated, so this is not a current production defect. If `MAX_RANGE_DAYS` changes later, there is no compile-time guard forcing `/catalog` to change with it.
- **Test-helper drift:** Non-blocking test risk. `packages/api/src/together.test.ts` has a local `resolveHorizonDaysForTest` helper that still mirrors the pre-clamp behavior. Existing default-env catalog tests are unaffected, but running those tests with `REFRESH_HORIZON_DAYS >= 366` would expect the old over-advertised horizon.

## Regression Test Added

- Added `H7` in `packages/ingester/src/horizon.test.ts:61` asserting:
  - `resolveHorizonDays({ REFRESH_HORIZON_DAYS: "400" }) === MAX_RANGE_DAYS - 1`
  - `resolveHorizonDays({ REFRESH_HORIZON_DAYS: "366" }) === MAX_RANGE_DAYS - 1`
  - `resolveHorizonDays({ REFRESH_HORIZON_DAYS: "365" }) === MAX_RANGE_DAYS - 1`

## Verification

- `npm run build -w @auscinema/ingester` - pass.
- `node dist/horizon.test.js` from `packages/ingester` - pass, 7/7 tests including `H7`.
- `npm run test -w @auscinema/ingester` - blocked by sandbox subprocess policy before assertions: Node's test runner failed each test file with `spawn EPERM`.
