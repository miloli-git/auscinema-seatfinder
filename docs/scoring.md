# Seat scoring model

Goal: a 0–100 score for an *available* seat representing "how much I'd want to sit there",
computed from auditorium geometry + the user's preference. Higher is better.

## Inputs
- `SeatMap` (normalised): `seats[]` with `row`/`col` (higher row = further back, col left→right),
  `status`, `areaId`; plus `areas[]` for class.
- `SeatPreference`: `targetDepth` (0 front … 1 back, default 0.65), `centralityWeight`,
  `depthWeight`, `allowedAreaKinds`, `avoidPaired`.

## Model (intended)
1. **Gate.** `status !== "available"` → 0. If `allowedAreaKinds` set and the seat's area kind is
   not in it → 0. If `avoidPaired` and `seat.paired` → 0 (or heavy penalty).
2. **Depth.** Over real seats, `minRow..maxRow`. `depth = (row - minRow)/(maxRow - minRow)`.
   `depthPenalty = |depth - targetDepth|` (0..1).
3. **Centrality.** Within the seat's own row, `minCol..maxCol`. `centre = (minCol+maxCol)/2`,
   `halfWidth = (maxCol-minCol)/2`. `centralityPenalty = |col - centre| / halfWidth` (0..1).
4. **Combine.** Normalise weights, `penalty = depthWeight*depthPenalty + centralityWeight*centralityPenalty`.
   `score = round(100 * (1 - penalty))`, clamped 0..100.

## Notes
- Compute row/col extents from real seats only (drop `spacer`).
- `rankSeats` = score all available, sort desc. `bestSeatScore` = max (or 0).
- Future signals (out of scope for v0.1): empirical demand heatmap, distance-to-aisle,
  edge-row penalties, group-of-N contiguity.
