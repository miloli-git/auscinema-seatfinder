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

const noopDayFilter = () => {};

describe("OptionList", () => {
  it("group mode defaults to the Most together lens and re-ranks on chip click without a reload", () => {
    const options = [
      option({ sessionId: "a", cinemaName: "A Cinema", bestBlockScore: 60 }),
      option({ sessionId: "b", cinemaName: "B Cinema", bestBlockScore: 95 }),
    ];
    const onSelect = vi.fn();
    const { container } = render(
      <OptionList
        options={options}
        party={2}
        groupMode={true}
        selectedSessionId={null}
        onSelectOption={onSelect}
        dayFilter={null}
        onDayFilterChange={noopDayFilter}
      />,
    );

    const cardOrder = () =>
      [...container.querySelectorAll(".optioncard")].map((el) => el.textContent ?? "");

    // Server order (Most together, default in group mode) preserved: A before B.
    expect(cardOrder()[0]).toMatch(/A Cinema/);

    fireEvent.click(screen.getByRole("tab", { name: "Best seats lens" }));

    expect(cardOrder()[0]).toMatch(/B Cinema/); // now ranked by bestBlockScore desc
  });

  it("47c fix #8: solo mode defaults to Best seats, not Most together", () => {
    const options = [
      option({ sessionId: "a", cinemaName: "A Cinema", bestBlockScore: 60 }),
      option({ sessionId: "b", cinemaName: "B Cinema", bestBlockScore: 95 }),
    ];
    const { container } = render(
      <OptionList
        options={options}
        party={2}
        groupMode={false}
        selectedSessionId={null}
        onSelectOption={vi.fn()}
        dayFilter={null}
        onDayFilterChange={noopDayFilter}
      />,
    );
    const cardOrder = [...container.querySelectorAll(".optioncard")].map((el) => el.textContent ?? "");
    expect(cardOrder[0]).toMatch(/B Cinema/); // bestBlockScore desc, the solo default
    expect(screen.getByRole("tab", { name: "Best seats lens" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows the honest no-good-seats state when no option clears the bar, without hiding the list", () => {
    const options = [
      option({ sessionId: "a", bestBlockScore: null, fitTier: "split" }),
      option({ sessionId: "b", bestBlockScore: null, fitTier: "split" }),
    ];
    render(
      <OptionList
        options={options}
        party={2}
        groupMode={false}
        selectedSessionId={null}
        onSelectOption={vi.fn()}
        dayFilter={null}
        onDayFilterChange={noopDayFilter}
      />,
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
      <OptionList
        options={options}
        party={2}
        groupMode={false}
        selectedSessionId={null}
        onSelectOption={vi.fn()}
        dayFilter={null}
        onDayFilterChange={noopDayFilter}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("47c fix #9: Soonest good is a pure re-rank — qualifying options sort first, non-qualifying after, nothing hidden", () => {
    const options = [
      option({ sessionId: "late-q", bestBlockScore: 80, startsAt: "2026-07-22T20:00:00.000Z", date: "2026-07-22" }),
      option({ sessionId: "early-noq", bestBlockScore: null, startsAt: "2026-07-21T10:00:00.000Z", date: "2026-07-21" }),
      option({ sessionId: "early-q", bestBlockScore: 75, startsAt: "2026-07-21T19:00:00.000Z", date: "2026-07-21" }),
    ];
    const { container } = render(
      <OptionList
        options={options}
        party={2}
        groupMode={false}
        selectedSessionId={null}
        onSelectOption={vi.fn()}
        dayFilter={null}
        onDayFilterChange={noopDayFilter}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Soonest good lens" }));
    const order = [...container.querySelectorAll(".optioncard")].map(
      (el) => el.getAttribute("aria-pressed") && el.textContent,
    );
    expect(order).toHaveLength(3); // all 3 present — no silent filtering
    expect(screen.queryByRole("status")).toBeNull(); // at least one qualifies -> no honest-state banner
  });

  it("Soonest good falls back to the full list and flags the honest state when nothing qualifies", () => {
    const options = [
      option({ sessionId: "a", bestBlockScore: null, startsAt: "2026-07-22T10:00:00.000Z" }),
      option({ sessionId: "b", bestBlockScore: null, startsAt: "2026-07-21T10:00:00.000Z" }),
    ];
    render(
      <OptionList
        options={options}
        party={2}
        groupMode={false}
        selectedSessionId={null}
        onSelectOption={vi.fn()}
        dayFilter={null}
        onDayFilterChange={noopDayFilter}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Soonest good lens" }));
    expect(screen.getByRole("status")).toHaveTextContent(/no session yet has a qualifying block/i);
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(2);
  });

  it("47c fix #2: day filter chips appear only when >1 distinct day is present, and narrow the list", () => {
    const options = [
      option({ sessionId: "sun", date: "2026-07-19", startsAt: "2026-07-19T19:00:00.000Z" }),
      option({ sessionId: "tue", date: "2026-07-21", startsAt: "2026-07-21T19:00:00.000Z" }),
    ];
    render(
      <OptionList
        options={options}
        party={2}
        groupMode={false}
        selectedSessionId={null}
        onSelectOption={vi.fn()}
        dayFilter={null}
        onDayFilterChange={noopDayFilter}
      />,
    );
    expect(screen.getByRole("tab", { name: "All days" })).toBeInTheDocument();
    expect(screen.getAllByText(/Sun 19 Jul|Tue 21 Jul/).length).toBeGreaterThan(0);
  });

  it("47c fix #2: selecting a specific day (controlled by the parent) narrows the option list to that day", () => {
    const options = [
      option({ sessionId: "sun", date: "2026-07-19", startsAt: "2026-07-19T19:00:00.000Z" }),
      option({ sessionId: "tue", date: "2026-07-21", startsAt: "2026-07-21T19:00:00.000Z" }),
    ];
    const { container } = render(
      <OptionList
        options={options}
        party={2}
        groupMode={false}
        selectedSessionId={null}
        onSelectOption={vi.fn()}
        dayFilter="2026-07-19"
        onDayFilterChange={noopDayFilter}
      />,
    );
    const cards = [...container.querySelectorAll(".optioncard")];
    expect(cards).toHaveLength(1);
    expect(cards[0]!.textContent).toMatch(/Sun 19 Jul/);
  });

  it("47c fix #2: 'All days' (default) groups cards under a day heading at each date transition in lens order", () => {
    const options = [
      option({ sessionId: "sun", date: "2026-07-19", startsAt: "2026-07-19T19:00:00.000Z" }),
      option({ sessionId: "tue", date: "2026-07-21", startsAt: "2026-07-21T19:00:00.000Z" }),
    ];
    render(
      <OptionList
        options={options}
        party={2}
        groupMode={false}
        selectedSessionId={null}
        onSelectOption={vi.fn()}
        dayFilter={null}
        onDayFilterChange={noopDayFilter}
      />,
    );
    const headers = [...document.querySelectorAll(".optionlist__daybreak")].map((el) => el.textContent);
    expect(headers).toEqual(["Sun 19 Jul", "Tue 21 Jul"]);
  });

  it("47c fix #2: single-day option sets never show the day filter row, and no day headers render", () => {
    const options = [option({ sessionId: "a" }), option({ sessionId: "b" })];
    render(
      <OptionList
        options={options}
        party={2}
        groupMode={false}
        selectedSessionId={null}
        onSelectOption={vi.fn()}
        dayFilter={null}
        onDayFilterChange={noopDayFilter}
      />,
    );
    expect(screen.queryByRole("tab", { name: "All days" })).toBeNull();
    expect(document.querySelector(".optionlist__daybreak")).toBeNull();
  });
});
