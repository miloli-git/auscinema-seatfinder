import type { ChainAdapter, SessionQuery, Cinema, Session, SeatMap } from "@auscinema/core";

/**
 * Village Cinemas adapter — STUB. Backend not yet reverse-engineered.
 * See docs/endpoints.md for what's known and the capture task for this chain.
 */
export class VillageAdapter implements ChainAdapter {
  readonly chain = "village" as const;
  async listCinemas(): Promise<Cinema[]> {
    throw new Error("VillageAdapter.listCinemas: not implemented");
  }
  async listSessions(_query: SessionQuery): Promise<Session[]> {
    throw new Error("VillageAdapter.listSessions: not implemented");
  }
  async getSeatMap(_sessionId: string, _opts?: { preview?: boolean }): Promise<SeatMap> {
    throw new Error("VillageAdapter.getSeatMap: not implemented");
  }
}
