/**
 * Cache-age dead-man alert (#30 P30.3 / C7). A pure, injectable helper plus a thin Discord/Slack/ntfy
 * webhook poster builder. The refresh worker calls `maybeEmitCacheAgeDeadManAlert` after each tick:
 * when the freshest SUCCESSFUL ingest (`refresh_runs.lastSuccessfulIngestAt`) has aged past a
 * threshold, the cache has gone quietly stale (the loop is up but nothing is landing) and we fire
 * one alert, then rate-limit repeats via a caller-owned `state` until `dedupeWindowMs` elapses.
 *
 * The trigger is ONLY `nowInstant - lastSuccessfulIngestAt > thresholdMs`. `oldestLiveFetchedAt` is
 * carried in the payload as operator context but never gates the alert.
 */

/** Discord (`content`) / Slack (`text`) / ntfy (`message`) multi-target webhook body + structured detail. */
export interface DeadManPayload {
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
}

/** Caller-owned mutable de-dupe state. Held in memory across ticks by the worker loop. */
export interface DeadManAlertState {
  lastAlertedAt?: Date;
  lastAlertKey?: string;
}

export interface MaybeEmitCacheAgeDeadManAlertDeps {
  nowInstant: Date;
  lastSuccessfulIngestAt: Date | null;
  oldestLiveFetchedAt?: Date | null;
  thresholdMs: number;
  dedupeWindowMs: number;
  state: DeadManAlertState;
  postWebhook: (payload: DeadManPayload) => Promise<void>;
}

export interface MaybeEmitCacheAgeDeadManAlertResult {
  alerted: boolean;
  cacheAgeMs: number | null;
}

const DEAD_MAN_TITLE = "AusCinema cache age dead-man";

function buildPayload(
  deps: MaybeEmitCacheAgeDeadManAlertDeps,
  cacheAgeMs: number,
): DeadManPayload {
  const ageMin = Math.round(cacheAgeMs / 60_000);
  const thresholdMin = Math.round(deps.thresholdMs / 60_000);
  const message =
    `${DEAD_MAN_TITLE}: cache age is ${cacheAgeMs}ms (~${ageMin}m), over the ${deps.thresholdMs}ms ` +
    `(~${thresholdMin}m) threshold — no successful ingest landed in time.`;
  return {
    content: message,
    text: message,
    message,
    title: DEAD_MAN_TITLE,
    deadMan: {
      type: "cache_age_dead_man",
      source: "refresh_runs.lastSuccessfulIngestAt",
      now: deps.nowInstant.toISOString(),
      cacheAgeMs,
      thresholdMs: deps.thresholdMs,
      lastSuccessfulIngestAt: deps.lastSuccessfulIngestAt?.toISOString() ?? null,
      oldestLiveFetchedAt: deps.oldestLiveFetchedAt?.toISOString() ?? null,
    },
  };
}

/**
 * Decide whether to fire the cache-age dead-man alert and, if so, post it.
 *
 * `cacheAgeMs = nowInstant - lastSuccessfulIngestAt` (null when there is no successful ingest at all;
 * a never-ingested ledger is left to the caller to handle separately rather than alerting on NaN).
 * Returns `cacheAgeMs` on every call (even when suppressed) so the loop can log it. De-dupe: once an
 * alert fires, repeats for the SAME condition are suppressed until `dedupeWindowMs` has elapsed since
 * the last fire; a changed `lastSuccessfulIngestAt` resets the window so a genuinely new staleness
 * episode re-alerts immediately.
 */
export async function maybeEmitCacheAgeDeadManAlert(
  deps: MaybeEmitCacheAgeDeadManAlertDeps,
): Promise<MaybeEmitCacheAgeDeadManAlertResult> {
  const { nowInstant, lastSuccessfulIngestAt, thresholdMs, dedupeWindowMs, state, postWebhook } = deps;

  if (lastSuccessfulIngestAt === null) {
    // No successful ingest recorded — `now - null` is undefined, so per the frozen trigger formula we
    // do not alert here (NaN > threshold is false). Caller owns the cold-start vs never-ingested case.
    return { alerted: false, cacheAgeMs: null };
  }

  const cacheAgeMs = nowInstant.getTime() - lastSuccessfulIngestAt.getTime();
  if (!(cacheAgeMs > thresholdMs)) {
    return { alerted: false, cacheAgeMs };
  }

  // Over threshold. Suppress when we already alerted for the same condition inside the dedupe window.
  const key = lastSuccessfulIngestAt.toISOString();
  const sameCondition = state.lastAlertKey === key;
  const withinWindow =
    state.lastAlertedAt !== undefined &&
    nowInstant.getTime() - state.lastAlertedAt.getTime() < dedupeWindowMs;
  if (sameCondition && withinWindow) {
    return { alerted: false, cacheAgeMs };
  }

  await postWebhook(buildPayload(deps, cacheAgeMs));
  state.lastAlertedAt = nowInstant;
  state.lastAlertKey = key;
  return { alerted: true, cacheAgeMs };
}

/** Minimal fetch surface the webhook poster needs (injectable for tests / parity with the watcher). */
export type DeadManFetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; statusText: string }>;

/**
 * Build a real Discord-compatible `postWebhook` from a webhook URL. When `webhookUrl` is empty/undefined
 * the poster logs to console and no-ops the network (so an unconfigured worker never throws). Mirrors
 * the watcher's `WebhookNotifier` headers (explicit UA: Discord 403s the default runtime UA).
 */
export function createDeadManWebhookPoster(
  webhookUrl: string | undefined,
  opts: { fetchImpl?: DeadManFetchLike; log?: (msg: string) => void } = {},
): (payload: DeadManPayload) => Promise<void> {
  const log = opts.log ?? ((m: string) => console.log(m));
  if (!webhookUrl) {
    return async (payload: DeadManPayload): Promise<void> => {
      log(`[dead-man] ${payload.message}`);
    };
  }
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as DeadManFetchLike);
  return async (payload: DeadManPayload): Promise<void> => {
    const res = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "auscinema-ingester/0.0.0",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`dead-man webhook POST failed: ${res.status} ${res.statusText}`);
    }
  };
}
