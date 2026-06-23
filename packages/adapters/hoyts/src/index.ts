import type { ChainAdapter, SessionQuery, Cinema, Session, SeatMap } from "@auscinema/core";

/**
 * Hoyts Cinemas adapter — STUB. Backend not yet reverse-engineered.
 * See docs/endpoints.md for what's known and the capture task for this chain.
 */
export class HoytsAdapter implements ChainAdapter {
  readonly chain = "hoyts" as const;
  async listCinemas(): Promise<Cinema[]> {
    throw new Error("HoytsAdapter.listCinemas: not implemented");
  }
  async listSessions(_query: SessionQuery): Promise<Session[]> {
    throw new Error("HoytsAdapter.listSessions: not implemented");
  }
  async getSeatMap(_sessionId: string, _opts?: { preview?: boolean }): Promise<SeatMap> {
    throw new Error("HoytsAdapter.getSeatMap: not implemented");
  }
}
