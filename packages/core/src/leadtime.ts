/**
 * Forward-scan lead-time / pair-availability analysis (GitHub issue #49).
 *
 * PURE aggregation over already-fetched, already-scored sessions. Given a set of upcoming
 * sessions - each carrying its seatable capacity, live availability, and the pre-computed
 * adjacent blocks for a (party, minScore) query - it answers: how far ahead is the EARLIEST
 * session with a qualifying adjacent block, and which session is the BUSIEST (highest sold %)?
 *
 * Deterministic: no clock, no network, no I/O. `today` is injected for lead-day math. The input
 * array is never mutated (a copy is sorted). All scoring/adjacency happens upstream via core
 * `scoreAvailableSeats` + `findAdjacentBlocks` - this module only aggregates their output.
 */
import type { SeatBlock } from "./blocks.js";

export interface SessionAvailability {
  sessionId: string;
  /** Business date "YYYY-MM-DD". */
  date: string;
  /** Local wall time "YYYY-MM-DDTHH:MM". */
  startTime: string;
  /** Sellable capacity = every seat the public could occupy (available + taken), as the caller
   *  defines "taken" for its chain. EXCLUDES spacers/structural. (The Event CLI counts
   *  available + sold + unavailable, since Event maps sold/held seats to `unavailable`.) */
  totalSeats: number;
  /** Currently available. */
  availableSeats: number;
  /** findAdjacentBlocks output for (party, minScore), best-first; MAY be empty. */
  blocks: SeatBlock[];
}

export interface LeadTimeOptions {
  /** Party size, >= 1. */
  party: number;
  /** Minimum per-seat score, 0..100. */
  minScore: number;
  /** "YYYY-MM-DD" - injected for deterministic lead-day math (NEVER read a clock in core). */
  today: string;
}

export interface SessionTimelineEntry {
  sessionId: string;
  date: string;
  startTime: string;
  totalSeats: number;
  availableSeats: number;
  /** round(100 * (total - available) / total); 0 when totalSeats <= 0. */
  soldPct: number;
  /** blocks.length > 0. */
  hasQualifyingPair: boolean;
  /** blocks[0].avgScore ?? null. */
  bestPairScore: number | null;
  /** blocks[0].seatIds ?? null. */
  bestPairSeatIds: string[] | null;
}

export interface LeadTimeReport {
  party: number;
  minScore: number;
  sessionsScanned: number;
  sessionsWithPair: number;
  /** Chronologically-first session WITH a qualifying pair; null if none. */
  earliest: SessionTimelineEntry | null;
  /** Whole days from `today` to earliest.date (>= 0); null if none. */
  earliestLeadDays: number | null;
  /** Highest soldPct; ties -> earliest chronologically; null if no sessions. */
  busiest: SessionTimelineEntry | null;
  /** ALL sessions, sorted ascending by (date, then startTime). */
  timeline: SessionTimelineEntry[];
}

/** Strict YYYY-MM-DD → UTC ms, or NaN if the string isn't a real calendar date (so "2026-02-31"
 *  is rejected rather than silently normalized to March by Date.parse). */
function utcMidnight(value: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return NaN;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms)) return NaN;
  const dt = new Date(ms);
  // Round-trip: reject impossible dates that V8 rolled over into the next month.
  if (
    dt.getUTCFullYear() !== Number(m[1]) ||
    dt.getUTCMonth() + 1 !== Number(m[2]) ||
    dt.getUTCDate() !== Number(m[3])
  ) {
    return NaN;
  }
  return ms;
}

/** Whole UTC-midnight day diff from `from` ("YYYY-MM-DD") to `to` ("YYYY-MM-DD"), clamped >= 0.
 *  Malformed/impossible dates are treated leniently as 0 (core never throws; the CLI guards real input). */
function leadDays(from: string, to: string): number {
  const a = utcMidnight(from);
  const b = utcMidnight(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  const diff = Math.round((b - a) / 86_400_000);
  return diff > 0 ? diff : 0;
}

function soldPct(totalSeats: number, availableSeats: number): number {
  // Contract: 0 when totalSeats <= 0. Out-of-contract nonsensical inputs (non-finite,
  // negative, available > total) are clamped here rather than thrown - core stays lenient.
  if (!Number.isFinite(totalSeats) || totalSeats <= 0) return 0;
  const avail = Number.isFinite(availableSeats) ? Math.min(Math.max(availableSeats, 0), totalSeats) : 0;
  return Math.round((100 * (totalSeats - avail)) / totalSeats);
}

function toEntry(s: SessionAvailability): SessionTimelineEntry {
  const best = s.blocks[0];
  return {
    sessionId: s.sessionId,
    date: s.date,
    startTime: s.startTime,
    totalSeats: s.totalSeats,
    availableSeats: s.availableSeats,
    soldPct: soldPct(s.totalSeats, s.availableSeats),
    hasQualifyingPair: s.blocks.length > 0,
    bestPairScore: best ? best.avgScore : null,
    bestPairSeatIds: best ? best.seatIds : null,
  };
}

export function buildLeadTimeReport(
  sessions: readonly SessionAvailability[],
  opts: LeadTimeOptions,
): LeadTimeReport {
  // Sort a COPY ascending by (date, startTime); never mutate the input.
  const timeline = [...sessions]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0))
    .map(toEntry);

  const earliest = timeline.find((e) => e.hasQualifyingPair) ?? null;
  const earliestLeadDays = earliest ? leadDays(opts.today, earliest.date) : null;

  // busiest = max soldPct; ties broken by earliest chronological (timeline already sorted).
  let busiest: SessionTimelineEntry | null = null;
  for (const e of timeline) {
    if (busiest === null || e.soldPct > busiest.soldPct) busiest = e;
  }

  return {
    party: opts.party,
    minScore: opts.minScore,
    sessionsScanned: sessions.length,
    sessionsWithPair: timeline.filter((e) => e.hasQualifyingPair).length,
    earliest,
    earliestLeadDays,
    busiest,
    timeline,
  };
}
