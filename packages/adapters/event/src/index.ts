import type { ChainAdapter, SessionQuery, Cinema, Session, SeatMap } from "@auscinema/core";

/**
 * Event Cinemas adapter — the reference implementation.
 *
 * Backend (reverse-engineered, no auth, send a browser UA + `X-Requested-With: XMLHttpRequest`):
 *   - GET /Cinemas/GetSessions?cinemaIds=58&movieId=19797&date=2026-07-21
 *       -> { Success, Data: { Movies:[ { CinemaModels:[ { Sessions:[ {Id,StartTime,...} ] } ] } ] } }
 *   - GET /Ticketing/Order/GetSeating?sessionId=15433720
 *       -> { Success, Data: { Seats:{ Rows:[ {RowName, Seats:[ {SeatId,SeatName,Status,AreaId,...} ]} ] }, Areas:[...] } }
 *
 * SeatId encodes physical geometry as "area|type|ROW|COLUMN" — the last two ints are the grid
 * coordinates that normalise into Seat.row / Seat.col. See docs/endpoints.md.
 *
 * TODO(event): implement all three methods + the raw->core mappers. Cinema list comes from
 * GET /api/cinemas/JsonLd.
 */
export class EventCinemasAdapter implements ChainAdapter {
  readonly chain = "event" as const;
  private readonly base = "https://www.eventcinemas.com.au";

  async listCinemas(): Promise<Cinema[]> {
    throw new Error("EventCinemasAdapter.listCinemas: not implemented");
  }

  async listSessions(_query: SessionQuery): Promise<Session[]> {
    throw new Error("EventCinemasAdapter.listSessions: not implemented");
  }

  async getSeatMap(_sessionId: string, _opts?: { preview?: boolean }): Promise<SeatMap> {
    throw new Error("EventCinemasAdapter.getSeatMap: not implemented");
  }
}
