import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { SeatBlock } from "./blocks.ts";
import { buildLeadTimeReport, type SessionAvailability } from "./leadtime.ts";

const DEFAULT_OPTS = { party: 2, minScore: 60, today: "2026-06-28" };

function block(overrides: Partial<SeatBlock> = {}): SeatBlock {
  return {
    row: 8,
    rowLabel: "J",
    startCol: 12,
    seatIds: ["J12", "J13"],
    avgScore: 88,
    minScore: 86,
    ...overrides,
  };
}

function session(
  overrides: Partial<SessionAvailability> & Pick<SessionAvailability, "sessionId" | "date">,
): SessionAvailability {
  return {
    sessionId: overrides.sessionId,
    date: overrides.date,
    startTime: overrides.startTime ?? `${overrides.date}T18:00`,
    totalSeats: overrides.totalSeats ?? 100,
    availableSeats: overrides.availableSeats ?? 100,
    blocks: overrides.blocks ?? [],
  };
}

describe("buildLeadTimeReport", () => {
  test("returns an empty report for empty input", () => {
    assert.deepEqual(buildLeadTimeReport([], DEFAULT_OPTS), {
      party: 2,
      minScore: 60,
      sessionsScanned: 0,
      sessionsWithPair: 0,
      earliest: null,
      earliestLeadDays: null,
      busiest: null,
      timeline: [],
    });
  });

  test("sorts all timeline entries by date then startTime", () => {
    const sessions = [
      session({ sessionId: "jul-02-evening", date: "2026-07-02", startTime: "2026-07-02T20:30" }),
      session({ sessionId: "jul-01-late", date: "2026-07-01", startTime: "2026-07-01T21:00" }),
      session({ sessionId: "jun-30-matinee", date: "2026-06-30", startTime: "2026-06-30T14:00" }),
      session({ sessionId: "jul-01-early", date: "2026-07-01", startTime: "2026-07-01T09:30" }),
    ];

    const report = buildLeadTimeReport(sessions, DEFAULT_OPTS);

    assert.deepEqual(
      report.timeline.map((entry) => entry.sessionId),
      ["jun-30-matinee", "jul-01-early", "jul-01-late", "jul-02-evening"],
    );
    assert.equal(report.timeline.length, sessions.length);
  });

  test("earliest skips earlier sessions without blocks and uses the first chronological session with blocks", () => {
    const best = block({ rowLabel: "K", seatIds: ["K14", "K15"], avgScore: 91, minScore: 89 });
    const report = buildLeadTimeReport(
      [
        session({ sessionId: "no-block-morning", date: "2026-07-01", startTime: "2026-07-01T09:00" }),
        session({ sessionId: "with-block-evening", date: "2026-07-01", startTime: "2026-07-01T19:00", blocks: [best] }),
        session({ sessionId: "with-block-next-day", date: "2026-07-02", startTime: "2026-07-02T10:00", blocks: [block()] }),
      ],
      DEFAULT_OPTS,
    );

    assert.equal(report.earliest?.sessionId, "with-block-evening");
    assert.equal(report.earliestLeadDays, 3);
    assert.equal(report.earliest?.hasQualifyingPair, true);
    assert.equal(report.earliest?.bestPairScore, 91);
    assert.deepEqual(report.earliest?.bestPairSeatIds, ["K14", "K15"]);
  });

  test("computes earliestLeadDays as whole calendar days and clamps past dates to zero", () => {
    const future = buildLeadTimeReport(
      [session({ sessionId: "future", date: "2026-07-01", blocks: [block()] })],
      DEFAULT_OPTS,
    );
    const sameDay = buildLeadTimeReport(
      [session({ sessionId: "same-day", date: "2026-06-28", startTime: "2026-06-28T23:30", blocks: [block()] })],
      DEFAULT_OPTS,
    );
    const past = buildLeadTimeReport(
      [session({ sessionId: "past", date: "2026-06-27", startTime: "2026-06-27T18:00", blocks: [block()] })],
      DEFAULT_OPTS,
    );

    assert.equal(future.earliestLeadDays, 3);
    assert.equal(sameDay.earliestLeadDays, 0);
    assert.equal(past.earliestLeadDays, 0);
  });

  test("calculates soldPct including zero-capacity and wide-open or sold-out bounds", () => {
    const report = buildLeadTimeReport(
      [
        session({ sessionId: "three-quarters-sold", date: "2026-07-01", totalSeats: 340, availableSeats: 85 }),
        session({ sessionId: "zero-capacity", date: "2026-07-02", totalSeats: 0, availableSeats: 0 }),
        session({ sessionId: "wide-open", date: "2026-07-03", totalSeats: 340, availableSeats: 340 }),
        session({ sessionId: "sold-out", date: "2026-07-04", totalSeats: 340, availableSeats: 0 }),
      ],
      DEFAULT_OPTS,
    );

    const soldPctById = new Map(report.timeline.map((entry) => [entry.sessionId, entry.soldPct]));
    assert.equal(soldPctById.get("three-quarters-sold"), 75);
    assert.equal(soldPctById.get("zero-capacity"), 0);
    assert.equal(soldPctById.get("wide-open"), 0);
    assert.equal(soldPctById.get("sold-out"), 100);
  });

  test("derives pair fields from blocks[0] and returns null pair details when blocks are empty", () => {
    const first = block({ row: 6, rowLabel: "G", startCol: 18, seatIds: ["G18", "G19"], avgScore: 94, minScore: 92 });
    const second = block({ row: 4, rowLabel: "E", startCol: 10, seatIds: ["E10", "E11"], avgScore: 89, minScore: 87 });
    const report = buildLeadTimeReport(
      [
        session({ sessionId: "has-blocks", date: "2026-07-01", blocks: [first, second] }),
        session({ sessionId: "empty-blocks", date: "2026-07-02", blocks: [] }),
      ],
      DEFAULT_OPTS,
    );

    assert.deepEqual(
      report.timeline.map((entry) => ({
        sessionId: entry.sessionId,
        hasQualifyingPair: entry.hasQualifyingPair,
        bestPairScore: entry.bestPairScore,
        bestPairSeatIds: entry.bestPairSeatIds,
      })),
      [
        {
          sessionId: "has-blocks",
          hasQualifyingPair: true,
          bestPairScore: 94,
          bestPairSeatIds: ["G18", "G19"],
        },
        {
          sessionId: "empty-blocks",
          hasQualifyingPair: false,
          bestPairScore: null,
          bestPairSeatIds: null,
        },
      ],
    );
  });

  test("selects busiest by highest soldPct and breaks ties by earliest chronological session", () => {
    const report = buildLeadTimeReport(
      [
        session({ sessionId: "later-tied-busy", date: "2026-07-03", startTime: "2026-07-03T10:00", totalSeats: 100, availableSeats: 10 }),
        session({ sessionId: "less-busy", date: "2026-07-01", startTime: "2026-07-01T09:00", totalSeats: 100, availableSeats: 20 }),
        session({ sessionId: "earlier-tied-busy", date: "2026-07-02", startTime: "2026-07-02T21:00", totalSeats: 100, availableSeats: 10 }),
      ],
      DEFAULT_OPTS,
    );

    assert.equal(report.busiest?.sessionId, "earlier-tied-busy");
    assert.equal(report.busiest?.soldPct, 90);
  });

  test("reports scan counts, echoes options, and does not mutate the input array order", () => {
    const first = session({ sessionId: "input-first-late", date: "2026-07-03", blocks: [block()] });
    const second = session({ sessionId: "input-second-early", date: "2026-07-01" });
    const third = session({ sessionId: "input-third-middle", date: "2026-07-02", blocks: [block({ seatIds: ["J16", "J17"] })] });
    const sessions = [first, second, third];
    const originalOrder = sessions.map((entry) => entry.sessionId);

    const report = buildLeadTimeReport(sessions, { party: 4, minScore: 72, today: "2026-06-28" });

    assert.equal(report.sessionsScanned, 3);
    assert.equal(report.sessionsWithPair, 2);
    assert.equal(report.party, 4);
    assert.equal(report.minScore, 72);
    assert.deepEqual(sessions.map((entry) => entry.sessionId), originalOrder);
    assert.strictEqual(sessions[0], first);
    assert.strictEqual(sessions[1], second);
    assert.strictEqual(sessions[2], third);
  });

  test("handles an Odyssey-shaped mix of open previews and near-sold opening sessions", () => {
    const previewPair = block({ row: 11, rowLabel: "L", startCol: 20, seatIds: ["L20", "L21"], avgScore: 93, minScore: 90 });
    const alternatePreviewPair = block({ row: 10, rowLabel: "K", startCol: 18, seatIds: ["K18", "K19"], avgScore: 90, minScore: 88 });
    const report = buildLeadTimeReport(
      [
        session({
          sessionId: "odyssey-opening-night-near-sold-no-pair",
          date: "2026-07-16",
          startTime: "2026-07-16T19:00",
          totalSeats: 340,
          availableSeats: 7,
          blocks: [],
        }),
        session({
          sessionId: "odyssey-preview-wide-open",
          date: "2026-07-01",
          startTime: "2026-07-01T13:00",
          totalSeats: 340,
          availableSeats: 302,
          blocks: [previewPair],
        }),
        session({
          sessionId: "odyssey-preview-evening",
          date: "2026-07-02",
          startTime: "2026-07-02T18:30",
          totalSeats: 340,
          availableSeats: 287,
          blocks: [alternatePreviewPair],
        }),
        session({
          sessionId: "odyssey-opening-weekend-limited-pair",
          date: "2026-07-17",
          startTime: "2026-07-17T20:30",
          totalSeats: 340,
          availableSeats: 18,
          blocks: [block({ rowLabel: "B", seatIds: ["B3", "B4"], avgScore: 61, minScore: 60 })],
        }),
        session({
          sessionId: "odyssey-opening-matinee-near-sold-no-pair",
          date: "2026-07-16",
          startTime: "2026-07-16T14:00",
          totalSeats: 340,
          availableSeats: 9,
          blocks: [],
        }),
      ],
      DEFAULT_OPTS,
    );

    assert.equal(report.earliest?.sessionId, "odyssey-preview-wide-open");
    assert.equal(report.earliestLeadDays, 3);
    assert.equal(report.earliest?.bestPairScore, 93);
    assert.deepEqual(report.earliest?.bestPairSeatIds, ["L20", "L21"]);
    assert.equal(report.busiest?.sessionId, "odyssey-opening-night-near-sold-no-pair");
    assert.equal(report.busiest?.hasQualifyingPair, false);
    assert.equal(report.sessionsScanned, 5);
    assert.equal(report.sessionsWithPair, 3);
    assert.deepEqual(
      report.timeline.map((entry) => entry.sessionId),
      [
        "odyssey-preview-wide-open",
        "odyssey-preview-evening",
        "odyssey-opening-matinee-near-sold-no-pair",
        "odyssey-opening-night-near-sold-no-pair",
        "odyssey-opening-weekend-limited-pair",
      ],
    );
  });
});
