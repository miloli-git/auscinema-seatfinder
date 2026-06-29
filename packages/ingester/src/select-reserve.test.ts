import { test } from "node:test";
import assert from "node:assert/strict";
import { selectDueSessions, type KnownSession } from "./index.js";

type RefreshTier = KnownSession["tier"];
type SkipKey = { chain: string; tier: string; cinemaId: string; date: string };

function minutes(n: number): number {
  return n * 60_000;
}

function hours(n: number): number {
  return n * 60 * 60_000;
}

function beforeInstant(now: Date, ageMs: number): Date {
  return new Date(now.getTime() - ageMs);
}

function known(
  overrides: Partial<KnownSession> & { sessionId: string; tier: RefreshTier; fetchedAt: Date },
): KnownSession {
  return {
    chain: "event",
    cinemaId: "C1",
    date: "2026-10-05",
    live: true,
    neverFetched: false,
    ...overrides,
  };
}

function selectedIds(result: ReturnType<typeof selectDueSessions>): string[] {
  return [...result.selected];
}

function skippedAt(skipped: unknown, key: SkipKey): number {
  if (Array.isArray(skipped)) {
    const row = skipped.find((candidate) => {
      const r = candidate as Record<string, unknown>;
      return r.chain === key.chain && r.tier === key.tier && r.cinemaId === key.cinemaId && r.date === key.date;
    }) as Record<string, unknown> | undefined;
    return Number(row?.count ?? row?.dropped ?? row?.skipped ?? 0);
  }

  if (!skipped || typeof skipped !== "object") return 0;
  const record = skipped as Record<string, unknown>;
  const flatKeys = [
    `${key.chain}|${key.tier}|${key.cinemaId}|${key.date}`,
    `${key.chain}:${key.tier}:${key.cinemaId}:${key.date}`,
    JSON.stringify(key),
  ];
  for (const flatKey of flatKeys) {
    if (typeof record[flatKey] === "number") return Number(record[flatKey]);
  }

  const chain = record[key.chain] as Record<string, unknown> | undefined;
  const tier = chain?.[key.tier] as Record<string, unknown> | undefined;
  const cinema = tier?.[key.cinemaId] as Record<string, unknown> | undefined;
  if (typeof cinema?.[key.date] === "number") return Number(cinema[key.date]);
  const cinemaDate = tier?.[`${key.cinemaId}|${key.date}`];
  if (typeof cinemaDate === "number") return Number(cinemaDate);
  return 0;
}

function totalSkipped(skipped: unknown): number {
  if (typeof skipped === "number") return skipped;
  if (!skipped || typeof skipped !== "object") return 0;
  if (Array.isArray(skipped)) {
    return skipped.reduce((sum, row) => {
      const r = row as Record<string, unknown>;
      return sum + Number(r.count ?? r.dropped ?? r.skipped ?? 0);
    }, 0);
  }
  return Object.values(skipped as Record<string, unknown>).reduce<number>(
    (sum, value) => sum + totalSkipped(value),
    0,
  );
}

test("H7 selectDueSessions reserves a first-ingest lane for a never-fetched T2 under a full T0 budget", () => {
  const nowInstant = new Date("2026-10-05T00:00:00.000Z");
  const nearTerm = Array.from({ length: 3 }, (_, i) =>
    known({
      sessionId: `near-t0-${i + 1}`,
      tier: "T0",
      fetchedAt: beforeInstant(nowInstant, hours(3) + minutes(i)),
    }),
  );
  const farFuture = known({
    sessionId: "far-future-t2",
    tier: "T2",
    date: "2026-10-20",
    fetchedAt: new Date(0),
    neverFetched: true,
  });

  const result = selectDueSessions([...nearTerm, farFuture], {
    budgetPerChain: 3,
    reserveForNew: 1,
    nowInstant,
  });

  assert.ok(selectedIds(result).includes("far-future-t2"), "the far-future first-ingest session is selected");
  assert.equal(result.selected.length, 4, "reserved selections are additive to the normal per-chain budget");
  assert.equal(totalSkipped(result.skipped), 0);
});

test("H8 selectDueSessions caps the reserved lane and reports never-fetched overflow in skipped", () => {
  const nowInstant = new Date("2026-10-05T00:00:00.000Z");
  const nearTerm = Array.from({ length: 3 }, (_, i) =>
    known({
      sessionId: `near-t0-${i + 1}`,
      tier: "T0",
      fetchedAt: beforeInstant(nowInstant, hours(3) + minutes(i)),
    }),
  );
  const farFuture = Array.from({ length: 5 }, (_, i) =>
    known({
      sessionId: `future-new-${i + 1}`,
      tier: "T2",
      date: "2026-10-20",
      fetchedAt: new Date(0),
      neverFetched: true,
    }),
  );

  const result = selectDueSessions([...nearTerm, ...farFuture], {
    budgetPerChain: 3,
    reserveForNew: 2,
    nowInstant,
  });
  const selected = selectedIds(result);
  const selectedNew = selected.filter((id) => id.startsWith("future-new-"));

  assert.equal(selectedNew.length, 2, "only reserveForNew never-fetched sessions fit before the T0 main budget");
  assert.equal(selected.length, 5);
  assert.ok(selected.length <= 3 + 2, "total selected per chain is bounded by budgetPerChain + reserveForNew");
  assert.equal(skippedAt(result.skipped, { chain: "event", tier: "T2", cinemaId: "C1", date: "2026-10-20" }), 3);
  assert.equal(totalSkipped(result.skipped), 3);
});

test("H9 selectDueSessions with reserveForNew 0 preserves the existing tier-priority round-robin selection", () => {
  const nowInstant = new Date("2026-10-05T00:00:00.000Z");
  const dense = Array.from({ length: 5 }, (_, i) =>
    known({
      sessionId: `dense-${i + 1}`,
      tier: "T0",
      cinemaId: "C1",
      date: "2026-10-05",
      fetchedAt: beforeInstant(nowInstant, hours(8) + minutes(i)),
    }),
  );
  const laterCinema = Array.from({ length: 2 }, (_, i) =>
    known({
      sessionId: `cinema-${i + 1}`,
      tier: "T0",
      cinemaId: "C2",
      date: "2026-10-05",
      fetchedAt: beforeInstant(nowInstant, hours(5) + minutes(i)),
    }),
  );
  const laterDate = Array.from({ length: 2 }, (_, i) =>
    known({
      sessionId: `date-${i + 1}`,
      tier: "T0",
      cinemaId: "C1",
      date: "2026-10-06",
      fetchedAt: beforeInstant(nowInstant, hours(4) + minutes(i)),
    }),
  );
  const olderLowerPriority = [
    known({
      sessionId: "old-t1",
      tier: "T1",
      cinemaId: "C3",
      date: "2026-10-07",
      fetchedAt: beforeInstant(nowInstant, hours(48)),
    }),
  ];

  const result = selectDueSessions([...dense, ...laterCinema, ...laterDate, ...olderLowerPriority], {
    budgetPerChain: 5,
    reserveForNew: 0,
    nowInstant,
  });

  assert.deepEqual(selectedIds(result), ["dense-5", "cinema-2", "date-2", "dense-4", "cinema-1"]);
  assert.equal(result.selected.length, 5);
  assert.equal(totalSkipped(result.skipped), 5);
  assert.equal(skippedAt(result.skipped, { chain: "event", tier: "T0", cinemaId: "C1", date: "2026-10-05" }), 3);
  assert.equal(skippedAt(result.skipped, { chain: "event", tier: "T0", cinemaId: "C1", date: "2026-10-06" }), 1);
  assert.equal(skippedAt(result.skipped, { chain: "event", tier: "T1", cinemaId: "C3", date: "2026-10-07" }), 1);
});

test("H10 selectDueSessions does not select the same never-fetched session in both reserved and main passes", () => {
  const nowInstant = new Date("2026-10-05T00:00:00.000Z");
  const result = selectDueSessions(
    [
      known({
        sessionId: "new-once",
        tier: "T2",
        date: "2026-10-20",
        fetchedAt: new Date(0),
        neverFetched: true,
      }),
    ],
    { budgetPerChain: 1, reserveForNew: 1, nowInstant },
  );
  const selected = selectedIds(result);

  assert.deepEqual(selected, ["new-once"]);
  assert.equal(new Set(selected).size, selected.length, "reserved session ids are unique in the selection");
  assert.equal(totalSkipped(result.skipped), 0);
});
