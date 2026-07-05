import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OptionCard } from "./OptionCard";
import type { Option } from "./types";

function option(overrides: Partial<Option>): Option {
  return {
    chain: "event",
    cinemaId: "1",
    cinemaName: "Test Cinema",
    sessionId: "s1",
    startsAt: "2026-07-21T19:00:00.000Z",
    date: "2026-07-21",
    format: "",
    isLargeFormat: false,
    formatRank: 0,
    bestBlockScore: null,
    bestBlockSize: null,
    fitTier: "split",
    togetherCount: 1,
    geometryConfidence: "exact",
    freshness: { asOf: "2026-07-21T01:00:00.000Z", state: "fresh" },
    bookingUrl: "https://example.test/book",
    ...overrides,
  };
}

describe("OptionCard", () => {
  it("renders the cinema name when populated", () => {
    render(
      <OptionCard
        option={option({ cinemaName: "Event George St" })}
        party={2}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(/Event George St/)).toBeInTheDocument();
  });

  /**
   * Contract amendment (API PR #69): cinemaName's "never empty" guarantee is steady-state only —
   * the backfill is a cache-only COALESCE, so a Hoyts/Reading row can still arrive with
   * `cinemaName: ""` before its first post-#67-fix ingest. Degrade to the chain label, never blank.
   */
  it("falls back to the chain label when cinemaName arrives blank (pre-#67-fix transition window)", () => {
    render(
      <OptionCard
        option={option({ chain: "hoyts", cinemaName: "" })}
        party={2}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(/Hoyts ·/)).toBeInTheDocument();
  });

  it("47c fix #1/#2: every card shows its own DATE, not just clock time — the fix for genuinely-ambiguous same-time-different-day cards", () => {
    render(
      <OptionCard
        option={option({ date: "2026-07-21", startsAt: "2026-07-21T19:00:00.000Z" })}
        party={2}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(/Tue 21 Jul/)).toBeInTheDocument();
  });

  it("47c fix #14: Hoyts approximate-geometry chip uses the same visible copy as SeatMapView's chip, not the cryptic '(~)'", () => {
    render(
      <OptionCard
        option={option({ chain: "hoyts", geometryConfidence: "approximate" })}
        party={2}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("Seat positions approximate")).toBeInTheDocument();
    expect(screen.queryByText("(~)")).toBeNull();
  });

  it("47c fix #9: a non-qualifying card (Soonest good's pure re-rank, no silent filter) states its own honest sub-copy", () => {
    render(
      <OptionCard
        option={option({ bestBlockScore: null })}
        party={2}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(/No qualifying block ·/)).toBeInTheDocument();
  });
});
