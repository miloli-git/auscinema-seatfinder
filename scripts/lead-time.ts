/**
 * Live lead-time / pair-availability finder (GitHub issue #49) - the integration acceptance gate.
 *
 * NOT a unit test and NOT imported by any test. A runnable script that hits the REAL Event backend:
 * across a forward date range it lists sessions for a movie at one cinema, fetches each seat map,
 * scores the available seats, finds adjacent blocks of `party` seats >= `minScore`, then feeds the
 * per-session availability into the PURE core `buildLeadTimeReport` and prints a readable report.
 *
 * The clock is read HERE only (start date defaults to today); the core stays pure - `today` is the
 * injected start date.
 *
 *   tsx scripts/lead-time.ts --movieId 19797 --cinemaId 96 --party 2 --minScore 60 --horizonDays 21
 *   tsx scripts/lead-time.ts --help
 *
 * Exit code is non-zero only on a hard failure (every date's listSessions threw). An empty result
 * (no sessions in range) is a clean exit with a "no sessions found" message.
 */
import { defaultRegistry, resolveAdapter } from "@auscinema/watcher";
import {
  scoreAvailableSeats,
  findAdjacentBlocks,
  buildLeadTimeReport,
  type Chain,
  type Session,
  type SeatMap,
  type SeatPreference,
  type BlockSeat,
  type SessionAvailability,
} from "@auscinema/core";

// --- args -------------------------------------------------------------------

interface Args {
  chain: Chain;
  cinemaId: string;
  movieId: string;
  party: number;
  minScore: number;
  horizonDays: number;
  startDate: string; // "YYYY-MM-DD"
  help: boolean;
}

const USAGE = `lead-time - forward-scan IMAX/pair-availability finder (issue #49)

Usage:
  tsx scripts/lead-time.ts [options]

Options:
  --chain <name>        cinema chain adapter (default: event)
  --cinemaId <id>       chain-native cinema id (required for a live run; IMAX Sydney = 96)
  --movieId <id>        chain-native movie id (required for a live run; The Odyssey = 19797)
  --party <n>           seats needed together (default: 2)
  --minScore <0-100>    minimum per-seat score to count as in-zone (default: 60)
  --horizonDays <n>     days to scan from the start date, inclusive (default: 21)
  --startDate <date>    "YYYY-MM-DD" scan start (default: today, from the system clock)
  --help                show this help

Example (The Odyssey @ IMAX Sydney):
  tsx scripts/lead-time.ts --movieId 19797 --cinemaId 96 --party 2 --minScore 60 --horizonDays 21
`;

/** Local YYYY-MM-DD from the system clock - the ONLY clock read; core stays pure. */
function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse a flag value as a whole number, returning NaN for anything not strictly all-digits
 *  (so "1abc"/"0.5" are rejected by validateArgs rather than truncated by parseInt). */
function strictInt(s: string): number {
  return /^\d+$/.test(s.trim()) ? Number(s) : NaN;
}

/** Parse a flag value as a number (allows a decimal), NaN for non-numeric tokens like "100abc". */
function strictNum(s: string): number {
  return /^\d+(\.\d+)?$/.test(s.trim()) ? Number(s) : NaN;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    chain: "event",
    cinemaId: "",
    movieId: "",
    party: 2,
    minScore: 60,
    horizonDays: 21,
    startDate: todayLocal(),
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--chain":
        args.chain = next() as Chain;
        break;
      case "--cinemaId":
        args.cinemaId = next();
        break;
      case "--movieId":
        args.movieId = next();
        break;
      case "--party":
        args.party = strictInt(next());
        break;
      case "--minScore":
        args.minScore = strictNum(next());
        break;
      case "--horizonDays":
        args.horizonDays = strictInt(next());
        break;
      case "--startDate":
        args.startDate = next();
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`unknown argument: ${a}`);
    }
  }
  return args;
}

/** Strict YYYY-MM-DD calendar check: round-trips through UTC so "2026-02-31" is rejected, not normalized. */
function isValidCalendarDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [, y, mo, d] = m;
  const dt = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return false;
  return (
    dt.getUTCFullYear() === Number(y) &&
    dt.getUTCMonth() + 1 === Number(mo) &&
    dt.getUTCDate() === Number(d)
  );
}

const MAX_HORIZON_DAYS = 90;

/** Validate parsed args BEFORE any network call. Returns an error message, or null if valid. */
function validateArgs(args: Args): string | null {
  if (!Number.isInteger(args.party) || args.party < 1) {
    return `--party must be a whole number >= 1 (got "${args.party}").`;
  }
  if (!Number.isFinite(args.minScore) || args.minScore < 0 || args.minScore > 100) {
    return `--minScore must be a number in 0..100 (got "${args.minScore}").`;
  }
  if (!Number.isInteger(args.horizonDays) || args.horizonDays < 0 || args.horizonDays > MAX_HORIZON_DAYS) {
    return `--horizonDays must be a whole number in 0..${MAX_HORIZON_DAYS} (got "${args.horizonDays}").`;
  }
  if (!isValidCalendarDate(args.startDate)) {
    return `--startDate must be a real YYYY-MM-DD calendar date (got "${args.startDate}").`;
  }
  return null;
}

/** Forward dates [start .. start+horizon] inclusive as YYYY-MM-DD (UTC-midnight arithmetic). */
function dateRange(startDate: string, horizonDays: number): string[] {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  if (Number.isNaN(start)) throw new Error(`invalid startDate: ${startDate}`);
  const out: string[] = [];
  for (let i = 0; i <= horizonDays; i++) {
    out.push(new Date(start + i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

// --- availability assembly --------------------------------------------------

/**
 * A seat counts toward sellable capacity if it's a real seat the public could occupy: available,
 * sold, OR unavailable. Event releases far-future houses in waves and maps both taken AND
 * not-yet-released seats to `unavailable` (its raw "Sold" status is rare for advance sales), so
 * counting only available+sold would treat a barely-released house as empty (the soldPct=0 bug).
 * Spacers and companion/special allocations are structural/non-general-sale and excluded.
 */
function isSeatable(status: string): boolean {
  return status === "available" || status === "sold" || status === "unavailable";
}

/** Map a session's seat map into the pure-core SessionAvailability shape. */
function toAvailability(session: Session, map: SeatMap, pref: SeatPreference, party: number, minScore: number): SessionAvailability {
  let totalSeats = 0;
  let availableSeats = 0;
  for (const s of map.seats) {
    if (!isSeatable(s.status)) continue;
    totalSeats += 1;
    if (s.status === "available") availableSeats += 1;
  }

  const blockSeats: BlockSeat[] = scoreAvailableSeats(map, pref).map(({ seat, score }) => ({
    id: seat.id,
    rowLabel: seat.rowLabel,
    row: seat.row,
    col: seat.col,
    score,
  }));
  const blocks = findAdjacentBlocks(blockSeats, { minScore, size: party });

  return {
    sessionId: session.id,
    date: session.startTime.slice(0, 10),
    startTime: session.startTime.slice(0, 16),
    totalSeats,
    availableSeats,
    blocks,
  };
}

// --- reporting --------------------------------------------------------------

function bar(pct: number, width = 20): string {
  // Clamp to 0..100 so a nonsensical upstream pct can never call "#".repeat(negative).
  const safe = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
  const filled = Math.round((safe / 100) * width);
  return `[${"#".repeat(filled)}${"-".repeat(Math.max(0, width - filled))}]`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (!args.cinemaId || !args.movieId) {
    process.stderr.write("error: --cinemaId and --movieId are required for a live run.\n\n");
    process.stderr.write(USAGE);
    process.exitCode = 1;
    return;
  }

  const argError = validateArgs(args);
  if (argError) {
    process.stderr.write(`error: ${argError}\n\n`);
    process.stderr.write(USAGE);
    process.exitCode = 1;
    return;
  }

  const adapter = resolveAdapter(defaultRegistry(), args.chain);
  const pref: SeatPreference = {}; // core defaults: targetDepth 0.65, balanced weights
  const dates = dateRange(args.startDate, args.horizonDays);

  console.log(
    `lead-time finder - chain=${args.chain} cinema=${args.cinemaId} movie=${args.movieId} ` +
      `party=${args.party} minScore=${args.minScore}\n` +
      `scanning ${dates.length} dates: ${dates[0]} .. ${dates[dates.length - 1]}\n`,
  );

  // Scan hygiene mirrors the ingester sweep: dedupe by session id so each session is fetched
  // ONCE even across adjacent date queries, drop leaky out-of-window results, and skip
  // unallocated sessions (no seat map to score) before any getSeatMap call.
  const sessionsById = new Map<string, Session>();
  let dateFailures = 0;

  for (const date of dates) {
    let sessions: Session[];
    try {
      sessions = await adapter.listSessions({ movieId: args.movieId, cinemaIds: [args.cinemaId], date });
    } catch (err) {
      dateFailures += 1;
      console.warn(`  ! ${date}: listSessions failed - ${(err as Error).message}`);
      continue;
    }
    for (const session of sessions) {
      if (!session.startTime.startsWith(date)) continue; // out-of-window leak
      if (!session.seatAllocation) continue; // unallocated/first-come - no seat map
      if (!sessionsById.has(session.id)) sessionsById.set(session.id, session);
    }
  }

  // Hard failure only when EVERY date threw (and there was something to scan).
  if (dateFailures === dates.length) {
    console.error(`\nhard failure: all ${dates.length} dates failed to list sessions.`);
    process.exitCode = 1;
    return;
  }

  const sessionsSeen = sessionsById.size;
  const availabilities: SessionAvailability[] = [];
  let seatMapFailures = 0;

  for (const session of sessionsById.values()) {
    try {
      const map = await adapter.getSeatMap(session.id);
      availabilities.push(toAvailability(session, map, pref, args.party, args.minScore));
    } catch (err) {
      seatMapFailures += 1;
      console.warn(`  ! ${session.startTime}: getSeatMap failed - ${(err as Error).message}`);
    }
  }

  // True empty case (CLEAN exit 0): no allocated-seating sessions listed on these dates at all.
  if (sessionsSeen === 0) {
    console.log(
      `\nno sessions on these dates for movie ${args.movieId} at cinema ${args.cinemaId} ` +
        `between ${dates[0]} and ${dates[dates.length - 1]}.`,
    );
    return;
  }

  // Total live failure (NON-ZERO exit): sessions WERE listed but every seat map failed to convert.
  if (availabilities.length === 0) {
    console.error(
      `\nseat-map failure: ${sessionsSeen} session(s) found between ${dates[0]} and ${dates[dates.length - 1]}, ` +
        `but all ${seatMapFailures} seat map(s) failed to load - no headline numbers produced.`,
    );
    process.exitCode = 1;
    return;
  }

  const report = buildLeadTimeReport(availabilities, {
    party: args.party,
    minScore: args.minScore,
    today: args.startDate,
  });

  console.log(`\n=== Lead-time report =========================================`);
  console.log(`sessions scanned : ${report.sessionsScanned}`);
  console.log(`sessions w/ pair : ${report.sessionsWithPair}`);

  if (report.earliest) {
    const e = report.earliest;
    console.log(
      `\nEARLIEST qualifying ${args.party}-seat block:` +
        `\n  ${e.date} ${e.startTime.slice(11)}  (lead ${report.earliestLeadDays} day(s) from ${args.startDate})` +
        `\n  best pair score ${e.bestPairScore}  seats ${e.bestPairSeatIds?.join(", ")}` +
        `\n  ${e.availableSeats} of ${e.totalSeats} seats available (${e.soldPct}% sold/held)`,
    );
  } else {
    console.log(`\nEARLIEST qualifying ${args.party}-seat block: none in the scanned window.`);
  }

  if (report.busiest) {
    const b = report.busiest;
    console.log(
      `\nBUSIEST session (highest % sold/held):` +
        `\n  ${b.date} ${b.startTime.slice(11)}  ${b.availableSeats} of ${b.totalSeats} available (${b.soldPct}% sold/held)` +
        `\n  has qualifying pair: ${b.hasQualifyingPair ? "yes" : "no"}`,
    );
  }

  console.log(`\nTIMELINE (date  time   sold/held%          pair  bestScore)`);
  for (const e of report.timeline) {
    const time = e.startTime.slice(11);
    const pct = String(e.soldPct).padStart(3);
    const pair = e.hasQualifyingPair ? "Y" : "-";
    const score = e.bestPairScore === null ? "  -" : String(e.bestPairScore).padStart(3);
    console.log(`  ${e.date} ${time}  ${pct}% ${bar(e.soldPct)}   ${pair}    ${score}`);
  }
  console.log(`==============================================================`);
  if (args.chain !== "event") {
    console.log(
      `note: sold/held% is most accurate for Event. On ${args.chain}, the "unavailable" bucket can ` +
        `include broken/house seats, so capacity + sold/held% are approximate.`,
    );
  }
}

main().catch((err) => {
  console.error(`lead-time crashed: ${(err as Error).stack ?? err}`);
  process.exitCode = 1;
});
