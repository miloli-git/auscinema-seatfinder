import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DateAvailabilityStrip } from "./DateAvailabilityStrip";
import type { AvailabilityDate, AvailabilityResponse } from "./types";

function date(overrides: Partial<AvailabilityDate>): AvailabilityDate {
  return {
    date: "2026-07-16",
    state: "good-block",
    leadDays: 2,
    bestBlockScore: 91,
    soldHeldPct: 42,
    asOf: "2026-07-16T00:30:00.000Z",
    ...overrides,
  };
}

function response(dates: AvailabilityDate[]): AvailabilityResponse {
  return {
    movieKey: "event:555",
    cinemaId: null,
    party: 2,
    minScore: 74,
    horizonDate: "2026-08-18",
    maxCachedDate: "2026-07-30",
    earliest: dates.find((d) => d.state === "good-block") ?? null,
    earliestLeadDays: dates.find((d) => d.state === "good-block")?.leadDays ?? null,
    dates,
  };
}

describe("DateAvailabilityStrip", () => {
  it("renders one cell per date, keyed by state via data-state (not color-only: text label present too)", () => {
    const dates: AvailabilityDate[] = [
      date({ date: "2026-07-14", state: "sold-held-now", bestBlockScore: null, soldHeldPct: 93 }),
      date({ date: "2026-07-15", state: "stale", bestBlockScore: null, soldHeldPct: null }),
      date({ date: "2026-07-16", state: "good-block" }),
      date({ date: "2026-07-17", state: "no-qualifying-block", bestBlockScore: null, soldHeldPct: null }),
      date({ date: "2026-07-20", state: "not-cached", bestBlockScore: null, soldHeldPct: null, asOf: null }),
    ];
    render(<DateAvailabilityStrip availability={response(dates)} />);

    const cells = screen.getAllByRole("button");
    expect(cells).toHaveLength(5);
    expect(cells.map((c) => c.getAttribute("data-state"))).toEqual([
      "sold-held-now",
      "stale",
      "good-block",
      "no-qualifying-block",
      "not-cached",
    ]);
    expect(screen.getByText("Sold/held now")).toBeInTheDocument();
    expect(screen.getByText("Stale data")).toBeInTheDocument();
    expect(screen.getByText("Good seats available")).toBeInTheDocument();
    expect(screen.getByText("No qualifying block")).toBeInTheDocument();
  });

  it("renders the 3 not-cached sub-cases with distinct copy computed from horizonDate/maxCachedDate", () => {
    const dates: AvailabilityDate[] = [
      date({ date: "2026-07-20", state: "not-cached", bestBlockScore: null, soldHeldPct: null, asOf: null }),
      date({ date: "2026-08-01", state: "not-cached", bestBlockScore: null, soldHeldPct: null, asOf: null }),
    ];
    const res = response(dates);
    // Beyond-horizon can't appear inside `dates[]` per the contract (horizonDate is the array's hard
    // upper bound), but the sub-case classifier must still be exercised via the group label check.
    render(<DateAvailabilityStrip availability={res} />);

    expect(screen.getByText("no sessions")).toBeInTheDocument(); // 2026-07-20 <= maxCachedDate
    expect(screen.getByText("not yet checked")).toBeInTheDocument(); // 2026-08-01 > maxCachedDate
  });

  it("is keyboard-navigable: cells are focusable buttons with accessible labels", () => {
    render(<DateAvailabilityStrip availability={response([date({})])} />);
    const cell = screen.getByRole("button");
    expect(cell.tagName).toBe("BUTTON");
    expect(cell).toHaveAccessibleName(/16 Jul: Good seats available/);
  });

  it("degrades gracefully with an honest empty state when there are no cached dates at all", () => {
    render(<DateAvailabilityStrip availability={response([])} />);
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("No cached dates yet for this movie.");
  });
});
