/**
 * The core check: for each watch, list sessions, filter, fetch seat maps politely,
 * rank seats, collect above-threshold available seats, de-dupe against prior alerts,
 * and notify only the new ones.
 */
import { rankSeats, type Session } from "@auscinema/core";
import type {
  NewSessionWatch,
  SeatAvailabilityWatch,
  Watch,
  WatcherConfig,
  TimeWindow,
} from "./config.js";
import type { AdapterRegistry } from "./registry.js";
import { resolveAdapter } from "./registry.js";
import { WatchState } from "./state.js";
import type { Hit, Notifier, SessionAlert } from "./notifier.js";

const DEFAULT_TIME_ZONE = "Australia/Sydney";

export interface CheckDeps {
  registry: AdapterRegistry;
  notifier: Notifier;
  state: WatchState;
  /** Max concurrent seat-map fetches. Default from config / 4. */
  concurrency?: number;
  /** Injectable clock for deterministic rolling-horizon checks. */
  now?: () => Date;
}

export interface CheckError {
  watchId: string;
  sessionId?: string;
  date?: string;
  error: string;
}

export interface CheckResult {
  /** Every above-threshold available seat found this run (incl. already-alerted). */
  hits: Hit[];
  /** The subset that was not previously alerted - what the notifier was sent. */
  newHits: Hit[];
  /** Every session observed by `new-session` watches this run. */
  sessions: SessionAlert[];
  /** Sessions first observed after their date scope had already been baselined. */
  newSessions: SessionAlert[];
  /** Per-watch errors; a failing watch doesn't abort the others. */
  errors: CheckError[];
}

/** Extract zero-padded "HH:MM" from an ISO-local start time, if present. */
function timeOf(startTime: string): string | undefined {
  const t = startTime.indexOf("T");
  if (t < 0) return undefined;
  return startTime.slice(t + 1, t + 6);
}

/** Inclusive time-window test. Missing window or unparseable time => included. */
export function inTimeWindow(startTime: string, window?: TimeWindow): boolean {
  if (!window) return true;
  const hm = timeOf(startTime);
  if (hm === undefined) return true;
  return hm >= window.from && hm <= window.to;
}

/** Candidate sessions: right date, in window, and seat-allocated (scorable). */
function candidateSessions(sessions: readonly Session[], watch: SeatAvailabilityWatch): Session[] {
  return sessions.filter(
    (s) => s.seatAllocation && s.startTime.startsWith(watch.date) && inTimeWindow(s.startTime, watch.timeWindow),
  );
}

function isNewSessionWatch(watch: Watch): watch is NewSessionWatch {
  return watch.alertOn === "new-session";
}

function dateInTimeZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value;
  const year = get("year");
  const month = get("month");
  const day = get("day");
  if (!year || !month || !day) throw new Error(`could not resolve current date in ${timeZone}`);
  return `${year}-${month}-${day}`;
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** Business dates queried by a new-session watch, inclusive of today and its look-ahead edge. */
export function datesForNewSessionWatch(watch: NewSessionWatch, now: Date, timeZone: string): string[] {
  if (watch.date) return [watch.date];
  const first = dateInTimeZone(now, timeZone);
  return Array.from({ length: (watch.lookaheadDays ?? 0) + 1 }, (_, index) => addDays(first, index));
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const run = async (): Promise<void> => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i] as T, i);
    }
  };
  const pool = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run);
  await Promise.all(pool);
  return results;
}

interface WatchOutcome {
  hits: Hit[];
  /** sessionPrefix for every session whose seat map was successfully fetched this run. */
  checkedSessionPrefixes: string[];
  errors: CheckError[];
}

interface SessionOutcome {
  hits: Hit[];
  prefix?: string;
  error?: CheckError;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Run one watch, returning its hits + the sessions it actually checked (no state mutation). */
async function checkSeatWatch(
  watch: SeatAvailabilityWatch,
  deps: CheckDeps,
  concurrency: number,
): Promise<WatchOutcome> {
  const adapter = resolveAdapter(deps.registry, watch.chain);
  const label = watch.label ?? watch.id;

  const sessions = await adapter.listSessions({
    movieId: watch.movieId,
    cinemaIds: watch.cinemaIds,
    date: watch.date,
  });
  const candidates = candidateSessions(sessions, watch);

  const perSession = await mapWithConcurrency<Session, SessionOutcome>(candidates, concurrency, async (session) => {
    try {
      // Polite: use the cached preview availability feed for polling.
      const map = await adapter.getSeatMap(session.id, { preview: true });
      const ranked = rankSeats(map, watch.preference);
      const hits: Hit[] = [];
      for (const { seat, score } of ranked) {
        if (score < watch.minScore) continue; // rankSeats is best-first -> rest are lower
        hits.push({
          watchId: watch.id,
          label,
          chain: watch.chain,
          sessionId: session.id,
          seatId: seat.id,
          ...(seat.name ? { seatName: seat.name } : {}),
          score,
          startTime: session.startTime,
          format: session.format.raw || session.format.kind,
          bookingUrl: session.bookingUrl,
        });
      }
      return { hits, prefix: WatchState.sessionPrefixOf(watch.id, session.id) };
    } catch (err) {
      return {
        hits: [],
        error: { watchId: watch.id, sessionId: session.id, error: errorMessage(err) },
      };
    }
  });

  return {
    hits: perSession.flatMap((p) => p.hits),
    checkedSessionPrefixes: perSession.flatMap((p) => (p.prefix ? [p.prefix] : [])),
    errors: perSession.flatMap((p) => (p.error ? [p.error] : [])),
  };
}

interface NewSessionOutcome {
  sessions: SessionAlert[];
  newSessions: SessionAlert[];
  errors: CheckError[];
}

function toSessionAlert(watch: NewSessionWatch, session: Session): SessionAlert {
  return {
    watchId: watch.id,
    label: watch.label ?? watch.id,
    chain: watch.chain,
    sessionId: session.id,
    movieId: session.movieId,
    ...(session.movieName ? { movieName: session.movieName } : {}),
    cinemaId: session.cinemaId,
    ...(session.cinemaName ? { cinemaName: session.cinemaName } : {}),
    startTime: session.startTime,
    format: session.format.raw || session.format.kind,
    ...(session.seatsAvailable !== undefined ? { seatsAvailable: session.seatsAvailable } : {}),
    bookingUrl: session.bookingUrl,
  };
}

/** Strict listing-level proof that ticket sales are open without fetching a full seat map. */
export function isPurchasableSession(session: Session): boolean {
  if (session.seatsAvailable === undefined || session.seatsAvailable <= 0) return false;
  try {
    return new URL(session.bookingUrl).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Poll lightweight session listings. Each date is silently baselined the first time it enters
 * scope; only unseen ids on an already-baselined date are alerts.
 */
async function checkNewSessionWatch(
  watch: NewSessionWatch,
  deps: CheckDeps,
  dates: readonly string[],
): Promise<NewSessionOutcome> {
  const adapter = resolveAdapter(deps.registry, watch.chain);
  const sessions: SessionAlert[] = [];
  const newSessions: SessionAlert[] = [];
  const errors: CheckError[] = [];

  // Keep discovery requests sequential: rolling watches can span many dates and should remain polite.
  for (const date of dates) {
    try {
      const listed = await adapter.listSessions({
        movieId: watch.movieId,
        cinemaIds: watch.cinemaIds,
        date,
      });
      const alerts = listed
        .filter(
          (session) =>
            session.startTime.startsWith(date) &&
            inTimeWindow(session.startTime, watch.timeWindow) &&
            (!watch.requirePurchasable || isPurchasableSession(session)),
        )
        .map((session) => toSessionAlert(watch, session))
        .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.sessionId.localeCompare(b.sessionId));
      sessions.push(...alerts);

      const baselined = deps.state.hasSessionBaseline(watch.id, date);
      for (const alert of alerts) {
        if (baselined && !deps.state.hasSeenSession(watch.id, alert.sessionId)) newSessions.push(alert);
        deps.state.markSessionSeen(watch.id, alert.sessionId);
      }
      deps.state.markSessionBaseline(watch.id, date);
    } catch (err) {
      errors.push({ watchId: watch.id, date, error: errorMessage(err) });
    }
  }

  return { sessions, newSessions, errors };
}

/**
 * Run all watches once. Mutates `deps.state` with the new alerts (caller persists it),
 * prunes stale entries for re-checked sessions, and notifies only the new hits.
 */
export async function runCheck(config: WatcherConfig, deps: CheckDeps): Promise<CheckResult> {
  const concurrency = deps.concurrency ?? config.concurrency ?? 4;
  const allHits: Hit[] = [];
  const checkedSessionPrefixes = new Set<string>();
  const allSessions: SessionAlert[] = [];
  const newSessions: SessionAlert[] = [];
  const errors: CheckResult["errors"] = [];

  for (const watch of config.watches) {
    try {
      if (isNewSessionWatch(watch)) {
        const dates = datesForNewSessionWatch(
          watch,
          deps.now?.() ?? new Date(),
          config.timeZone ?? DEFAULT_TIME_ZONE,
        );
        const outcome = await checkNewSessionWatch(watch, deps, dates);
        allSessions.push(...outcome.sessions);
        newSessions.push(...outcome.newSessions);
        errors.push(...outcome.errors);
      } else {
        const outcome = await checkSeatWatch(watch, deps, concurrency);
        allHits.push(...outcome.hits);
        // Record every (watch, session) actually checked - including sold-out ones with no
        // hits - so stale alerts for them can be pruned.
        for (const prefix of outcome.checkedSessionPrefixes) checkedSessionPrefixes.add(prefix);
        errors.push(...outcome.errors);
      }
    } catch (err) {
      errors.push({ watchId: watch.id, error: errorMessage(err) });
    }
  }

  const currentHitKeys = new Set(allHits.map((h) => WatchState.keyOf(h.watchId, h.sessionId, h.seatId)));

  // Optional self-heal: a seat we alerted that is no longer a hit (and whose session we
  // re-checked) is cleared, so it can re-alert if it reopens.
  deps.state.pruneStale(checkedSessionPrefixes, currentHitKeys);

  const newHits = allHits.filter((h) => !deps.state.has(WatchState.keyOf(h.watchId, h.sessionId, h.seatId)));
  for (const h of newHits) {
    deps.state.add(WatchState.keyOf(h.watchId, h.sessionId, h.seatId));
  }

  if (newHits.length > 0) {
    await deps.notifier.notify(newHits);
  }
  if (newSessions.length > 0) {
    await deps.notifier.notifySessions(newSessions);
  }

  return { hits: allHits, newHits, sessions: allSessions, newSessions, errors };
}
