/**
 * Live end-to-end integration smoke (GitHub issue #11).
 *
 * NOT part of CI and NOT a `node --test` suite. This is a runnable script that hits the REAL
 * chain backends for a CURRENT date (computed from the system clock) and exercises the whole
 * pipeline per chain: listCinemas -> listSessions -> getSeatMap -> rankSeats. It catches
 * real-world drift the date-bound offline fixtures can't.
 *
 * Run:  npm run smoke    (builds the workspaces, then runs this against live backends)
 *
 * Behaviour:
 *   - Each chain runs independently; one chain failing does not abort the others.
 *   - Exit code is non-zero if ANY chain failed, so it can gate a deploy.
 *   - Polite: one cinema and at most a few sessions per chain; the adapters' own 15s timeout
 *     + single retry apply; no hammering.
 *   - Discovers ids dynamically (no hardcoded, expiry-prone fixture ids).
 */
import { EventCinemasAdapter } from "@auscinema/adapter-event";
import { HoytsAdapter } from "@auscinema/adapter-hoyts";
import { ReadingAdapter } from "@auscinema/adapter-reading";
import { VillageAdapter } from "@auscinema/adapter-village";
import { rankSeats, type ChainAdapter, type Cinema, type Session } from "@auscinema/core";

// --- knobs ------------------------------------------------------------------

const DATE_HORIZON_DAYS = 7; // today .. today+7
const MAX_SESSIONS_PER_CHAIN = 4; // seat maps fetched at most, to stay polite
const MAX_DATES_WITH_SESSIONS = 1; // stop date-scan at the first date that yields usable sessions

/** Substrings that flag a major-metro cinema, so the smoke prefers a busy site with live sessions. */
const METRO_HINTS = [
  "sydney",
  "george st",
  "bondi",
  "burwood",
  "castle hill",
  "parramatta",
  "macquarie",
  "melbourne",
  "crown",
  "chadstone",
  "jam factory",
  "brisbane",
  "carindale",
  "indooroopilly",
  "chermside",
  "robina",
  "newmarket",
  "auburn",
  "charlestown",
  "perth",
  "innaloo",
];

// --- date helpers -----------------------------------------------------------

/** Local YYYY-MM-DD for `today + offset` days, derived from the system clock at runtime. */
function localDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function candidateDates(): string[] {
  const out: string[] = [];
  for (let i = 0; i <= DATE_HORIZON_DAYS; i++) out.push(localDate(i));
  return out;
}

// --- per-chain smoke --------------------------------------------------------

interface ChainResult {
  chain: string;
  ok: boolean;
  line: string;
}

function pickCinema(cinemas: Cinema[]): Cinema {
  const metro = cinemas.find((c) => {
    const hay = `${c.name} ${c.region ?? ""}`.toLowerCase();
    return METRO_HINTS.some((h) => hay.includes(h));
  });
  return metro ?? cinemas[0]!;
}

/** A session is worth trying if it has allocated seating and isn't known-empty. */
function usable(s: Session): boolean {
  if (!s.seatAllocation) return false;
  if (typeof s.seatsAvailable === "number" && s.seatsAvailable <= 0) return false;
  return true;
}

async function smokeChain(name: string, adapter: ChainAdapter): Promise<ChainResult> {
  const fail = (reason: string): ChainResult => ({ chain: name, ok: false, line: `FAIL ${name} — ${reason}` });
  try {
    // 1. cinemas
    const cinemas = await adapter.listCinemas();
    if (cinemas.length === 0) return fail("listCinemas() returned 0 cinemas");
    const cinema = pickCinema(cinemas);

    // 2. + 3. near date -> sessions (movieId discovered from the feed itself; empty movieId
    // pulls the unfiltered feed so we never depend on an expired fixture id).
    let chosenDate = "";
    let sessions: Session[] = [];
    let datesWithSessions = 0;
    for (const date of candidateDates()) {
      let pulled: Session[];
      try {
        pulled = await adapter.listSessions({ movieId: "", cinemaIds: [cinema.id], date });
      } catch {
        continue; // a single bad date shouldn't abort the chain's date scan
      }
      const candidates = pulled.filter(usable);
      if (candidates.length > 0) {
        if (datesWithSessions === 0) {
          chosenDate = date;
          sessions = candidates;
        }
        datesWithSessions += 1;
        if (datesWithSessions >= MAX_DATES_WITH_SESSIONS) break;
      }
    }
    if (sessions.length === 0) {
      return fail(`no allocated-seating sessions at ${cinema.name} in the next ${DATE_HORIZON_DAYS} days`);
    }

    // 4. seat map + scoring — try a few sessions in case the first is genuinely sold out.
    const tried = sessions.slice(0, MAX_SESSIONS_PER_CHAIN);
    let lastReason = "no seat map with available seats";
    for (const session of tried) {
      let map;
      try {
        map = await adapter.getSeatMap(session.id);
      } catch (err) {
        lastReason = `getSeatMap failed: ${(err as Error).message}`;
        continue;
      }
      const realSeats = map.seats.filter((s) => s.status !== "spacer");
      if (realSeats.length === 0) {
        lastReason = "seat map had 0 real seats";
        continue;
      }
      const ranked = rankSeats(map);
      if (ranked.length === 0) {
        lastReason = `seat map fully sold out (${realSeats.length} seats, 0 available)`;
        continue; // genuinely sold out — try another session
      }
      const top = ranked[0]!.score;
      const where = session.movieName ? `${cinema.name} (${session.movieName})` : cinema.name;
      return {
        chain: name,
        ok: true,
        line:
          `PASS ${name} — ${cinemas.length} cinemas, ${sessions.length} sessions @ ${where} ${chosenDate}, ` +
          `${realSeats.length}-seat map, top score ${top}`,
      };
    }
    return fail(lastReason);
  } catch (err) {
    return fail((err as Error).message);
  }
}

// --- runner -----------------------------------------------------------------

async function main(): Promise<void> {
  const now = new Date();
  console.log(`auscinema live smoke — ${now.toISOString()} (dates ${localDate(0)} .. ${localDate(DATE_HORIZON_DAYS)})\n`);

  const chains: Array<[string, ChainAdapter]> = [
    ["event", new EventCinemasAdapter()],
    ["hoyts", new HoytsAdapter()],
    ["reading", new ReadingAdapter()],
    ["village", new VillageAdapter()],
  ];

  // Run all chains in parallel but independently; one failure can't abort the others.
  const results = await Promise.all(chains.map(([name, adapter]) => smokeChain(name, adapter)));

  for (const r of results) console.log(r.line);

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed`);

  if (passed < results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`smoke crashed: ${(err as Error).stack ?? err}`);
  process.exitCode = 1;
});
