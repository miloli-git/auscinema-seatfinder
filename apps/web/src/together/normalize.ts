// L2a — Fork-1 normaliser: maps a /together result `session` (format as a
// string, nullable `screen`, plus a `date` the web Session does not use) into
// the web `Session` shape (`format: {kind, raw}`, optional `screenName`, no date).
//
// The kind-mapping rules are replicated from the event adapter's `mapFormat`
// (packages/adapters/event/src/index.ts ~L139). We deliberately do NOT import
// from the adapter package so the web build stays decoupled from the package graph.
import type { Chain, ScreenFormat, Session } from "../types";

/** Wire shape of a `/together` result's `session` (see docs/ST-4-tdd-plan.md). */
export interface TogetherSession {
  id: string;
  chain: Chain;
  movieId: string;
  movieName: string;
  cinemaId: string;
  cinemaName: string;
  /** UTC ISO start; web derives the filing date from this, not from `date`. */
  startTime: string;
  /** Approximate cache date (YYYY-MM-DD); intentionally not carried onto Session. */
  date: string;
  format: string | null;
  screen: string | null;
  seatsAvailable?: number;
  bookingUrl: string;
  seatAllocation: boolean;
}

/** Replicated event-adapter mapFormat rules: lowercase, strip spaces/hyphens, match kind. */
function mapFormat(raw: string): ScreenFormat {
  const k = raw.toLowerCase().replace(/[\s-]/g, "");
  let kind: ScreenFormat["kind"];
  if (k.includes("vmax")) kind = "vmax";
  else if (k.includes("goldclass")) kind = "goldclass";
  else if (k.includes("imax")) kind = "imax";
  else if (k.includes("standard")) kind = "standard";
  else kind = "other";
  return { kind, raw };
}

export function normalizeTogetherSession(raw: TogetherSession): Session {
  const session: Session = {
    id: raw.id,
    chain: raw.chain,
    movieId: raw.movieId,
    movieName: raw.movieName,
    cinemaId: raw.cinemaId,
    cinemaName: raw.cinemaName,
    startTime: raw.startTime,
    format: raw.format === null ? { kind: "other", raw: "" } : mapFormat(raw.format),
    seatsAvailable: raw.seatsAvailable,
    seatAllocation: raw.seatAllocation,
    bookingUrl: raw.bookingUrl,
  };
  // Omit screenName entirely when the source screen is null.
  if (raw.screen !== null) session.screenName = raw.screen;
  return session;
}
