import { describe, expect, it } from "vitest";
import { sydneyNow, isUpcoming, formatInstantSydney } from "./format";

// Sydney is UTC+10 (AEST) in winter and UTC+11 (AEDT) in summer (DST ~ Oct–Apr).
describe("sydneyNow (UTC instant -> Sydney wall date/time)", () => {
  it("winter (June, AEST +10): 01:04Z -> same-day 11:04", () => {
    expect(sydneyNow(new Date("2026-06-25T01:04:17.672Z"))).toEqual({ date: "2026-06-25", time: "11:04" });
  });

  it("summer (January, AEDT +11) crossing midnight: 13:30Z -> next-day 00:30", () => {
    expect(sydneyNow(new Date("2026-01-15T13:30:00.000Z"))).toEqual({ date: "2026-01-16", time: "00:30" });
  });

  it("midnight is 00:00 not 24:00 (h23): winter Sydney midnight = 14:00Z prior day", () => {
    expect(sydneyNow(new Date("2026-06-24T14:00:00.000Z"))).toEqual({ date: "2026-06-25", time: "00:00" });
  });
});

describe("isUpcoming (local-wall-time startTime vs Sydney now)", () => {
  const now = { date: "2026-06-25", time: "22:22" };

  it("future date is upcoming regardless of time", () => {
    expect(isUpcoming("2026-06-26T10:30:00.000Z", now)).toBe(true);
  });

  it("past date is not upcoming", () => {
    expect(isUpcoming("2026-06-24T23:59:00.000Z", now)).toBe(false);
  });

  it("today, later showtime is upcoming", () => {
    expect(isUpcoming("2026-06-25T23:00:00.000Z", now)).toBe(true);
  });

  it("today, earlier showtime is NOT upcoming (the 2pm-shown-at-10pm bug)", () => {
    expect(isUpcoming("2026-06-25T14:00:00.000Z", now)).toBe(false);
  });

  it("today, exactly now counts as upcoming (>=)", () => {
    expect(isUpcoming("2026-06-25T22:22:00.000Z", now)).toBe(true);
  });

  it("treats the Z as local wall-time, NOT a real UTC instant", () => {
    // 14:00 'Z' is 2pm Sydney here; if it were parsed as true UTC it would be midnight Sydney and
    // wrongly read as past/future on the wrong day. The substring compare keeps it correct.
    expect(isUpcoming("2026-06-25T14:00:00.000Z", { date: "2026-06-25", time: "13:00" })).toBe(true);
    expect(isUpcoming("2026-06-25T14:00:00.000Z", { date: "2026-06-25", time: "15:00" })).toBe(false);
  });
});

describe("formatInstantSydney (true UTC instant -> Sydney clock)", () => {
  it("01:04Z (winter) renders as 11:04 am, not 1:04 am (#44)", () => {
    const out = formatInstantSydney("2026-06-25T01:04:17.672Z");
    expect(out.replace(/ /g, " ").toLowerCase()).toBe("11:04 am");
  });

  it("invalid input falls back to the raw string", () => {
    expect(formatInstantSydney("not-a-date")).toBe("not-a-date");
  });
});
