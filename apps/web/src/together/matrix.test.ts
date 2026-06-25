import {
  buildMatrix,
  cellKey,
  compareScoreCells,
  type TogetherResult,
  type TogetherBlock,
} from "./matrix";
import type { TogetherSession } from "./normalize";

function rawSession(over: Partial<TogetherSession> = {}): TogetherSession {
  return {
    id: "s1",
    chain: "event",
    movieId: "19796",
    movieName: "Supergirl",
    cinemaId: "A",
    cinemaName: "Cinema A",
    date: "2026-06-27",
    startTime: "2026-06-27T19:00:00.000Z",
    format: "IMAX",
    screen: null,
    seatsAvailable: 100,
    bookingUrl: "https://example.test/book/s1",
    seatAllocation: true,
    ...over,
  };
}

function block(avgScore: number): TogetherBlock {
  return {
    row: -7,
    rowLabel: "L",
    startCol: -18,
    seatIds: ["a", "b"],
    avgScore,
    minScore: avgScore,
  };
}

function result(session: Partial<TogetherSession>, blk: TogetherBlock | null): TogetherResult {
  return { session: rawSession(session), block: blk, approximateAdjacency: false, fetchedAt: "x" };
}

const ALL = { formats: [] as never[], timePreset: "any" as const, minScore: 74 };

// A coherent fixture: cinemas A,B over 2026-06-27..29 with a great-block cell,
// a sold cell, and empty gaps. NOTE: `block: null` (the sold path) only occurs
// in live data after #39 ships; tests author it directly per the post-#39 contract.
function fixture(): TogetherResult[] {
  return [
    // A / 27: two blocked sessions -> score cell, best avg 92, 2 sessions
    result({ id: "a27a", cinemaId: "A", cinemaName: "Cinema A", startTime: "2026-06-27T19:00:00.000Z" }, block(80)),
    result({ id: "a27b", cinemaId: "A", cinemaName: "Cinema A", startTime: "2026-06-27T21:00:00.000Z" }, block(92)),
    // A / 29: one blockless session -> sold
    result({ id: "a29", cinemaId: "A", cinemaName: "Cinema A", startTime: "2026-06-29T19:00:00.000Z" }, null),
    // B / 27: blockless -> sold
    result({ id: "b27", cinemaId: "B", cinemaName: "Cinema B", startTime: "2026-06-27T19:00:00.000Z" }, null),
    // B / 28: blocked avg 70 -> score
    result({ id: "b28", cinemaId: "B", cinemaName: "Cinema B", startTime: "2026-06-28T19:00:00.000Z" }, block(70)),
    // (A/28, B/29 absent -> empty gaps)
  ];
}

describe("buildMatrix (L2c)", () => {
  it("L2c.1 best block among a (cinema,date)'s sessions -> {score, avgScore, sessionCount}", () => {
    const m = buildMatrix(fixture(), ALL);
    expect(m.cells.get(cellKey("A", "2026-06-27"))).toEqual({
      kind: "score",
      avgScore: 92,
      sessionCount: 2,
    });
    expect(m.cells.get(cellKey("B", "2026-06-28"))).toEqual({
      kind: "score",
      avgScore: 70,
      sessionCount: 1,
    });
  });

  it("L2c.2 sessions exist but none has a block -> {sold}", () => {
    const m = buildMatrix(fixture(), ALL);
    expect(m.cells.get(cellKey("A", "2026-06-29"))).toEqual({ kind: "sold" });
    expect(m.cells.get(cellKey("B", "2026-06-27"))).toEqual({ kind: "sold" });
  });

  it("L2c.3 no session in window -> {empty} (gaps filled)", () => {
    const m = buildMatrix(fixture(), ALL);
    expect(m.cells.get(cellKey("A", "2026-06-28"))).toEqual({ kind: "empty" });
    expect(m.cells.get(cellKey("B", "2026-06-29"))).toEqual({ kind: "empty" });
  });

  it("L2c.4 rows = distinct cinemas (first-appearance order), cols = contiguous date range", () => {
    const m = buildMatrix(fixture(), ALL);
    expect(m.cinemas).toEqual([
      { id: "A", name: "Cinema A" },
      { id: "B", name: "Cinema B" },
    ]);
    expect(m.dates).toEqual(["2026-06-27", "2026-06-28", "2026-06-29"]);
  });

  it("L2c.4 cinema order follows first appearance, not name", () => {
    const m = buildMatrix(
      [
        result({ id: "z", cinemaId: "Z", cinemaName: "Zzz Cinema", startTime: "2026-06-27T19:00:00.000Z" }, block(50)),
        result({ id: "a", cinemaId: "A", cinemaName: "Aaa Cinema", startTime: "2026-06-27T19:00:00.000Z" }, block(50)),
      ],
      ALL,
    );
    expect(m.cinemas.map((c) => c.id)).toEqual(["Z", "A"]);
  });

  it("L2c.5 does not re-filter blocks by minScore (block below minScore still scores)", () => {
    const m = buildMatrix(
      [result({ id: "low", cinemaId: "A", cinemaName: "Cinema A", startTime: "2026-06-27T19:00:00.000Z" }, block(40))],
      { formats: [], timePreset: "any", minScore: 90 },
    );
    expect(m.cells.get(cellKey("A", "2026-06-27"))).toEqual({
      kind: "score",
      avgScore: 40,
      sessionCount: 1,
    });
  });

  it("L2c.6 best = highest avgScore; deterministic regardless of input order", () => {
    const fwd = buildMatrix(fixture(), ALL);
    const rev = buildMatrix([...fixture()].reverse(), ALL);
    expect(fwd.cells.get(cellKey("A", "2026-06-27"))).toEqual(rev.cells.get(cellKey("A", "2026-06-27")));
    expect(fwd.cells.get(cellKey("A", "2026-06-27"))).toEqual({
      kind: "score",
      avgScore: 92,
      sessionCount: 2,
    });
  });

  it("L2c.6 compareScoreCells tie-break: avgScore, then sessions, then earlier date", () => {
    // higher avgScore wins
    expect(
      compareScoreCells(
        { avgScore: 90, sessionCount: 1, date: "2026-06-27" },
        { avgScore: 80, sessionCount: 9, date: "2026-06-26" },
      ),
    ).toBeLessThan(0);
    // equal avgScore -> more sessions wins
    expect(
      compareScoreCells(
        { avgScore: 90, sessionCount: 3, date: "2026-06-28" },
        { avgScore: 90, sessionCount: 1, date: "2026-06-27" },
      ),
    ).toBeLessThan(0);
    // equal avgScore + sessions -> earlier date wins
    expect(
      compareScoreCells(
        { avgScore: 90, sessionCount: 2, date: "2026-06-27" },
        { avgScore: 90, sessionCount: 2, date: "2026-06-28" },
      ),
    ).toBeLessThan(0);
  });

  it("filters: out-of-filter sessions drop from axes and cells", () => {
    const m = buildMatrix(fixture(), { formats: ["vmax"], timePreset: "any", minScore: 74 });
    expect(m.cinemas).toEqual([]);
    expect(m.dates).toEqual([]);
    expect(m.cells.size).toBe(0);
  });

  it("empty input -> empty matrix", () => {
    const m = buildMatrix([], ALL);
    expect(m).toEqual({ cinemas: [], dates: [], cells: new Map() });
  });
});
