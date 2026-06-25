import { normalizeTogetherSession, type TogetherSession } from "./normalize";

// Base raw /together session (wire shape per docs/ST-4-tdd-plan.md "Wire shapes").
function rawSession(over: Partial<TogetherSession> = {}): TogetherSession {
  return {
    id: "15412843",
    chain: "event",
    movieId: "19796",
    movieName: "Supergirl",
    cinemaId: "96",
    cinemaName: "IMAX Sydney",
    date: "2026-06-28",
    startTime: "2026-06-28T21:15:00.000Z",
    format: "IMAX",
    screen: null,
    seatsAvailable: 322,
    bookingUrl: "https://example.test/book/15412843",
    seatAllocation: true,
    ...over,
  };
}

describe("normalizeTogetherSession (L2a)", () => {
  it("L2a.1 maps format string \"IMAX\" -> {kind:'imax', raw:'IMAX'}", () => {
    expect(normalizeTogetherSession(rawSession({ format: "IMAX" })).format).toEqual({
      kind: "imax",
      raw: "IMAX",
    });
  });

  it("L2a.1 reuses event mapFormat rules (case + space/hyphen insensitive)", () => {
    const cases: Array<[string, string]> = [
      ["Gold Class", "goldclass"],
      ["gold-class", "goldclass"],
      ["V-Max", "vmax"],
      ["VMAX", "vmax"],
      ["Standard", "standard"],
      ["4DX", "other"],
    ];
    for (const [raw, kind] of cases) {
      expect(normalizeTogetherSession(rawSession({ format: raw })).format).toEqual({ kind, raw });
    }
  });

  it("L2a.2 maps format null -> {kind:'other', raw:''}", () => {
    expect(normalizeTogetherSession(rawSession({ format: null })).format).toEqual({
      kind: "other",
      raw: "",
    });
  });

  it("L2a.3 maps screen -> screenName", () => {
    expect(normalizeTogetherSession(rawSession({ screen: "Screen 3" })).screenName).toBe("Screen 3");
  });

  it("L2a.3 null screen -> screenName undefined (key omitted)", () => {
    const session = normalizeTogetherSession(rawSession({ screen: null }));
    expect(session.screenName).toBeUndefined();
    expect("screenName" in session).toBe(false);
  });

  it("L2a.4 preserves id/chain/movieId/movieName/cinemaId/cinemaName/startTime/seatsAvailable/bookingUrl/seatAllocation", () => {
    const raw = rawSession();
    const session = normalizeTogetherSession(raw);
    expect(session.id).toBe(raw.id);
    expect(session.chain).toBe(raw.chain);
    expect(session.movieId).toBe(raw.movieId);
    expect(session.movieName).toBe(raw.movieName);
    expect(session.cinemaId).toBe(raw.cinemaId);
    expect(session.cinemaName).toBe(raw.cinemaName);
    expect(session.startTime).toBe(raw.startTime);
    expect(session.seatsAvailable).toBe(raw.seatsAvailable);
    expect(session.bookingUrl).toBe(raw.bookingUrl);
    expect(session.seatAllocation).toBe(raw.seatAllocation);
  });

  it("L2a.5 does not carry a `date` field onto Session (filing date derives from startTime)", () => {
    const session = normalizeTogetherSession(rawSession({ date: "2026-06-28" }));
    expect("date" in session).toBe(false);
    expect(session.startTime.slice(0, 10)).toBe("2026-06-28");
  });
});
