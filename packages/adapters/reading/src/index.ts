import type { ChainAdapter, SessionQuery, Cinema, Session, SeatMap } from "@auscinema/core";

/**
 * Reading Cinemas adapter — STUB. Backend not yet reverse-engineered.
 * See docs/endpoints.md for what's known and the capture task for this chain.
 */
export class ReadingAdapter implements ChainAdapter {
  readonly chain = "reading" as const;
  async listCinemas(): Promise<Cinema[]> {
    throw new Error("ReadingAdapter.listCinemas: not implemented");
  }
  async listSessions(_query: SessionQuery): Promise<Session[]> {
    throw new Error("ReadingAdapter.listSessions: not implemented");
  }
  async getSeatMap(_sessionId: string, _opts?: { preview?: boolean }): Promise<SeatMap> {
    throw new Error("ReadingAdapter.getSeatMap: not implemented");
  }
}
