import { matchesFormat, matchesTime, isEvening, isWeekend, type FormatSelector } from "./filters";
import type { Session } from "../types";

function session(over: Partial<Session> = {}): Session {
  return {
    id: "1",
    chain: "event",
    movieId: "m1",
    movieName: "Movie",
    cinemaId: "c1",
    cinemaName: "Cinema",
    startTime: "2026-06-29T14:00:00.000Z", // Mon, 14:00 wall-clock (afternoon, weekday)
    format: { kind: "imax", raw: "IMAX" },
    seatAllocation: true,
    bookingUrl: "https://example.test/book/1",
    ...over,
  };
}

describe("matchesFormat (L2b.1)", () => {
  it("empty selection = all pass", () => {
    expect(matchesFormat(session({ format: { kind: "vmax", raw: "V-Max" } }), [])).toBe(true);
  });

  it("passes when the session kind is selected (raw: null = kind-only match)", () => {
    const selected: FormatSelector[] = [{ kind: "imax", raw: null }, { kind: "vmax", raw: null }];
    expect(matchesFormat(session({ format: { kind: "imax", raw: "IMAX" } }), selected)).toBe(true);
  });

  it("fails when the session kind is not selected", () => {
    expect(
      matchesFormat(session({ format: { kind: "standard", raw: "Standard" } }), [
        { kind: "imax", raw: null },
      ]),
    ).toBe(false);
  });

  it("#92: an other/premium chip matches on kind+raw-label pair, not kind alone", () => {
    const xtreme = session({ format: { kind: "other", raw: "Xtremescreen" } });
    const dbox = session({ format: { kind: "other", raw: "D-BOX" } });
    const selected: FormatSelector[] = [{ kind: "other", raw: "Xtremescreen" }];
    expect(matchesFormat(xtreme, selected)).toBe(true);
    expect(matchesFormat(dbox, selected)).toBe(false);
  });

  it("#92: the blank-raw 'other'/'premium' fallback bucket (raw: '') matches only label-less sessions", () => {
    const labelless = session({ format: { kind: "other", raw: "" } });
    const labelled = session({ format: { kind: "other", raw: "Xtremescreen" } });
    const selected: FormatSelector[] = [{ kind: "other", raw: "" }];
    expect(matchesFormat(labelless, selected)).toBe(true);
    expect(matchesFormat(labelled, selected)).toBe(false);
  });
});

describe("matchesTime (L2b.2)", () => {
  it("Any passes everything", () => {
    expect(matchesTime(session({ startTime: "2026-06-29T03:00:00.000Z" }), "any")).toBe(true);
  });

  it("Evenings: wall-clock hour >= 17 passes, < 17 fails", () => {
    expect(matchesTime(session({ startTime: "2026-06-29T17:00:00.000Z" }), "evenings")).toBe(true);
    expect(matchesTime(session({ startTime: "2026-06-29T21:15:00.000Z" }), "evenings")).toBe(true);
    expect(matchesTime(session({ startTime: "2026-06-29T16:59:00.000Z" }), "evenings")).toBe(false);
    expect(matchesTime(session({ startTime: "2026-06-29T09:00:00.000Z" }), "evenings")).toBe(false);
  });

  it("Weekends: Sat/Sun pass, weekdays fail", () => {
    expect(matchesTime(session({ startTime: "2026-06-27T10:00:00.000Z" }), "weekends")).toBe(true); // Sat
    expect(matchesTime(session({ startTime: "2026-06-28T10:00:00.000Z" }), "weekends")).toBe(true); // Sun
    expect(matchesTime(session({ startTime: "2026-06-26T10:00:00.000Z" }), "weekends")).toBe(false); // Fri
    expect(matchesTime(session({ startTime: "2026-06-29T10:00:00.000Z" }), "weekends")).toBe(false); // Mon
  });
});

describe("day+time predicates compose (L2b.3)", () => {
  const sat_evening = session({ startTime: "2026-06-27T19:00:00.000Z" }); // Sat 19:00
  const sat_morning = session({ startTime: "2026-06-27T09:00:00.000Z" }); // Sat 09:00
  const mon_evening = session({ startTime: "2026-06-29T19:00:00.000Z" }); // Mon 19:00

  it("Evenings AND Weekends only passes a weekend evening", () => {
    expect(isEvening(sat_evening) && isWeekend(sat_evening)).toBe(true);
    expect(isEvening(sat_morning) && isWeekend(sat_morning)).toBe(false);
    expect(isEvening(mon_evening) && isWeekend(mon_evening)).toBe(false);
  });
});
