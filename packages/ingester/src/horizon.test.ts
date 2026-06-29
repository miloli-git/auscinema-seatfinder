import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addCalendarDays,
  DEFAULT_HORIZON_DAYS,
  effectiveWindow,
  horizonDate,
  MAX_RANGE_DAYS,
  resolveHorizonDays,
} from "./index.js";

test("H1 addCalendarDays uses UTC calendar math across month, leap, year, zero, and negative offsets", () => {
  assert.equal(addCalendarDays("2026-06-29", 35), "2026-08-03");
  assert.equal(addCalendarDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addCalendarDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addCalendarDays("2026-06-29", 0), "2026-06-29");
  assert.equal(addCalendarDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addCalendarDays("2026-08-03", -35), "2026-06-29");
});

test("H2 effectiveWindow rolls to today plus horizon and does not cap at the watch static dateTo", () => {
  assert.deepEqual(
    effectiveWindow({ dateFrom: "2026-06-26", dateTo: "2026-07-26" }, "2026-06-29", 35),
    { from: "2026-06-29", to: "2026-08-03" },
  );
});

test("H3 effectiveWindow clamps past dateFrom to today and honours future dateFrom", () => {
  assert.deepEqual(
    effectiveWindow({ dateFrom: "2026-06-26", dateTo: "2026-07-26" }, "2026-06-29", 35),
    { from: "2026-06-29", to: "2026-08-03" },
  );
  assert.deepEqual(
    effectiveWindow({ dateFrom: "2026-07-10", dateTo: "2026-07-26" }, "2026-06-29", 35),
    { from: "2026-07-10", to: "2026-08-03" },
  );
});

test("H4 effectiveWindow returns null when the watch starts beyond the rolling horizon", () => {
  assert.equal(
    effectiveWindow({ dateFrom: "2027-01-01", dateTo: "2027-01-31" }, "2026-06-29", 35),
    null,
  );
});

test("H5 horizonDate returns the far edge of the rolling coverage window", () => {
  assert.equal(horizonDate("2026-06-29", 35), "2026-08-03");
});

test("H6 resolveHorizonDays uses the default, valid overrides, and rejects empty or garbage values", () => {
  assert.equal(DEFAULT_HORIZON_DAYS, 35);
  assert.equal(resolveHorizonDays({}), 35);
  assert.equal(resolveHorizonDays({ REFRESH_HORIZON_DAYS: "60" }), 60);
  assert.equal(resolveHorizonDays({ REFRESH_HORIZON_DAYS: "0" }), 35);
  assert.equal(resolveHorizonDays({ REFRESH_HORIZON_DAYS: "-1" }), 35);
  assert.equal(resolveHorizonDays({ REFRESH_HORIZON_DAYS: "not-a-number" }), 35);
  assert.equal(resolveHorizonDays({ REFRESH_HORIZON_DAYS: "" }), 35);
});

test("H7 resolveHorizonDays clamps to the largest inclusive date range datesInRange can expand", () => {
  assert.equal(resolveHorizonDays({ REFRESH_HORIZON_DAYS: "400" }), MAX_RANGE_DAYS - 1);
  assert.equal(resolveHorizonDays({ REFRESH_HORIZON_DAYS: "366" }), MAX_RANGE_DAYS - 1);
  assert.equal(resolveHorizonDays({ REFRESH_HORIZON_DAYS: "365" }), MAX_RANGE_DAYS - 1);
});
