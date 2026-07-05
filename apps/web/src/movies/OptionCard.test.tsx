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
    expect(screen.getByText(/^Hoyts ·/)).toBeInTheDocument();
  });
});
