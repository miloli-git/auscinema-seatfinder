import type { Chain, Cinema, Session, SeatMap } from "./types.js";

/** Parameters for listing sessions of a movie at one or more cinemas on a date. */
export interface SessionQuery {
  movieId: string;
  /** One or more chain-native cinema ids. */
  cinemaIds: string[];
  /** Business date, "YYYY-MM-DD". */
  date: string;
}

/**
 * The single contract every chain adapter implements. Scoring, the API service and the
 * watcher depend only on this — never on a chain's raw payloads.
 */
export interface ChainAdapter {
  readonly chain: Chain;
  /** All cinemas for the chain (used to resolve ids and build pickers). */
  listCinemas(): Promise<Cinema[]>;
  /** Sessions for a movie at the given cinemas on the given date. */
  listSessions(query: SessionQuery): Promise<Session[]>;
  /**
   * Live seat map for a session. `preview` (default true) requests the more-cached
   * availability feed where the chain offers one, for polite polling; pass false only
   * at the moment of surfacing/booking.
   */
  getSeatMap(sessionId: string, opts?: { preview?: boolean }): Promise<SeatMap>;
}
