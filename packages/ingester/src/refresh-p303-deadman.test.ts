import { test } from "node:test";
import assert from "node:assert/strict";

type DeadManPayload = {
  content: string;
  text: string;
  message: string;
  title: string;
  deadMan: {
    type: "cache_age_dead_man";
    source: "refresh_runs.lastSuccessfulIngestAt";
    now: string;
    cacheAgeMs: number;
    thresholdMs: number;
    lastSuccessfulIngestAt: string | null;
    oldestLiveFetchedAt: string | null;
  };
};

type DeadManAlertState = {
  lastAlertedAt?: Date;
  lastAlertKey?: string;
};

type MaybeEmitCacheAgeDeadManAlert = (deps: {
  nowInstant: Date;
  lastSuccessfulIngestAt: Date | null;
  oldestLiveFetchedAt?: Date | null;
  thresholdMs: number;
  dedupeWindowMs: number;
  state: DeadManAlertState;
  postWebhook: (payload: DeadManPayload) => Promise<void>;
}) => Promise<{ alerted: boolean; cacheAgeMs: number | null }>;

async function requireMaybeEmitCacheAgeDeadManAlert(): Promise<MaybeEmitCacheAgeDeadManAlert> {
  const mod = (await import("./index.js")) as Record<string, unknown>;
  const candidate = mod.maybeEmitCacheAgeDeadManAlert;
  assert.equal(
    typeof candidate,
    "function",
    "P30.3 must export maybeEmitCacheAgeDeadManAlert({ nowInstant, lastSuccessfulIngestAt, oldestLiveFetchedAt?, thresholdMs, dedupeWindowMs, state, postWebhook })",
  );
  return candidate as MaybeEmitCacheAgeDeadManAlert;
}

function minutes(n: number): number {
  return n * 60_000;
}

function beforeInstant(now: Date, ageMs: number): Date {
  return new Date(now.getTime() - ageMs);
}

function capturingPoster(calls: DeadManPayload[]): (payload: DeadManPayload) => Promise<void> {
  return async (payload: DeadManPayload): Promise<void> => {
    calls.push(payload);
  };
}

test("P30.3 dead-man posts a Discord-compatible payload when cache age exceeds the threshold", async () => {
  const maybeEmit = await requireMaybeEmitCacheAgeDeadManAlert();
  const nowInstant = new Date("2026-06-26T00:00:00.000Z");
  const lastSuccessfulIngestAt = beforeInstant(nowInstant, minutes(61));
  const oldestLiveFetchedAt = beforeInstant(nowInstant, minutes(90));
  const calls: DeadManPayload[] = [];

  const result = await maybeEmit({
    nowInstant,
    lastSuccessfulIngestAt,
    oldestLiveFetchedAt,
    thresholdMs: minutes(60),
    dedupeWindowMs: minutes(30),
    state: {},
    postWebhook: capturingPoster(calls),
  });

  assert.equal(result.alerted, true);
  assert.equal(result.cacheAgeMs, minutes(61));
  assert.equal(calls.length, 1);
  const payload = calls[0]!;
  assert.equal(payload.title, "AusCinema cache age dead-man");
  assert.equal(payload.text, payload.content, "payload mirrors watcher's generic webhook text shape");
  assert.equal(payload.message, payload.content, "payload mirrors watcher's generic webhook message shape");
  assert.match(payload.content, /cache age/i);
  assert.deepEqual(payload.deadMan, {
    type: "cache_age_dead_man",
    source: "refresh_runs.lastSuccessfulIngestAt",
    now: nowInstant.toISOString(),
    cacheAgeMs: minutes(61),
    thresholdMs: minutes(60),
    lastSuccessfulIngestAt: lastSuccessfulIngestAt.toISOString(),
    oldestLiveFetchedAt: oldestLiveFetchedAt.toISOString(),
  });
});

test("P30.3 dead-man does not post when cache age is under the threshold", async () => {
  const maybeEmit = await requireMaybeEmitCacheAgeDeadManAlert();
  const nowInstant = new Date("2026-06-26T00:00:00.000Z");
  const calls: DeadManPayload[] = [];

  const result = await maybeEmit({
    nowInstant,
    lastSuccessfulIngestAt: beforeInstant(nowInstant, minutes(59)),
    oldestLiveFetchedAt: beforeInstant(nowInstant, minutes(90)),
    thresholdMs: minutes(60),
    dedupeWindowMs: minutes(30),
    state: {},
    postWebhook: capturingPoster(calls),
  });

  assert.deepEqual(result, { alerted: false, cacheAgeMs: minutes(59) });
  assert.deepEqual(calls, []);
});

test("P30.3 dead-man de-dupes repeated over-threshold alerts inside the dedupe window", async () => {
  const maybeEmit = await requireMaybeEmitCacheAgeDeadManAlert();
  const firstNow = new Date("2026-06-26T00:00:00.000Z");
  const lastSuccessfulIngestAt = beforeInstant(firstNow, minutes(61));
  const state: DeadManAlertState = {};
  const calls: DeadManPayload[] = [];
  const common = {
    lastSuccessfulIngestAt,
    oldestLiveFetchedAt: beforeInstant(firstNow, minutes(90)),
    thresholdMs: minutes(60),
    dedupeWindowMs: minutes(30),
    state,
    postWebhook: capturingPoster(calls),
  };

  const first = await maybeEmit({ ...common, nowInstant: firstNow });
  const second = await maybeEmit({ ...common, nowInstant: new Date(firstNow.getTime() + minutes(5)) });
  const third = await maybeEmit({ ...common, nowInstant: new Date(firstNow.getTime() + minutes(31)) });

  assert.equal(first.alerted, true);
  assert.deepEqual(second, { alerted: false, cacheAgeMs: minutes(66) });
  assert.equal(third.alerted, true);
  assert.equal(calls.length, 2, "the second over-threshold check is rate-limited by shared state");
});
