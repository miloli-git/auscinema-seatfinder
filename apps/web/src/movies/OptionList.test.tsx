import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OptionList } from "./OptionList";
import type { Option } from "./types";

function option(overrides: Partial<Option>): Option {
  return {
    chain: "event",
    cinemaId: "1",
    cinemaName: "Test Cinema",
    sessionId: overrides.sessionId ?? "s1",
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

describe("OptionList", () => {
  it("defaults to the Most together lens and re-ranks on chip click without a reload", () => {
    const options = [
      option({ sessionId: "a", cinemaName: "A Cinema", bestBlockScore: 60 }),
      option({ sessionId: "b", cinemaName: "B Cinema", bestBlockScore: 95 }),
    ];
    const onSelect = vi.fn();
    const { container } = render(
      <OptionList options={options} party={2} selectedSessionId={null} onSelectOption={onSelect} />,
    );

    const cardOrder = () =>
      [...container.querySelectorAll(".optioncard")].map((el) => el.textContent ?? "");

    // Server order (Most together, default) preserved: A before B.
    expect(cardOrder()[0]).toMatch(/A Cinema/);

    fireEvent.click(screen.getByRole("tab", { name: "Best seats lens" }));

    expect(cardOrder()[0]).toMatch(/B Cinema/); // now ranked by bestBlockScore desc
  });

  it("shows the honest no-good-seats state when no option clears the bar, without hiding the list", () => {
    const options = [
      option({ sessionId: "a", bestBlockScore: null, fitTier: "split" }),
      option({ sessionId: "b", bestBlockScore: null, fitTier: "split" }),
    ];
    render(
      <OptionList options={options} party={2} selectedSessionId={null} onSelectOption={vi.fn()} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/no great seats/i);
    // Cards still render — the honest state augments, it does not replace the list.
    expect(screen.getAllByRole("button", { pressed: false }).length).toBeGreaterThan(0);
  });

  it("does not show the honest state when at least one option qualifies", () => {
    const options = [
      option({ sessionId: "a", bestBlockScore: 80 }),
      option({ sessionId: "b", bestBlockScore: null }),
    ];
    render(
      <OptionList options={options} party={2} selectedSessionId={null} onSelectOption={vi.fn()} />,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("Soonest good falls back to the full list and flags the honest state when nothing qualifies", () => {
    const options = [
      option({ sessionId: "a", bestBlockScore: null, startsAt: "2026-07-22T10:00:00.000Z" }),
      option({ sessionId: "b", bestBlockScore: null, startsAt: "2026-07-21T10:00:00.000Z" }),
    ];
    render(
      <OptionList options={options} party={2} selectedSessionId={null} onSelectOption={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Soonest good lens" }));
    expect(screen.getByRole("status")).toHaveTextContent(/no session yet has a qualifying block/i);
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(2);
  });
});
