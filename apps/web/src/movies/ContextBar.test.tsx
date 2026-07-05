import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContextBar } from "./ContextBar";

const noop = () => {};

describe("ContextBar", () => {
  it("hides per-day steppers in solo mode and shows a solo party stepper instead", () => {
    render(
      <ContextBar
        groupMode={false}
        onToggleGroupMode={noop}
        soloParty={2}
        onSoloPartyChange={noop}
        minScore={74}
        onMinScoreChange={noop}
        days={[{ date: "2026-07-21", label: "Tue 21 Jul", count: 2 }]}
        onDayCountChange={noop}
        onSkipToResults={noop}
      />,
    );
    expect(screen.getByText("Party")).toBeInTheDocument();
    expect(screen.queryByText("Tue 21 Jul")).toBeNull();
  });

  it("toggling Plan group reveals a stepper per cached day with keyboard-reachable +/- buttons", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <ContextBar
        groupMode={false}
        onToggleGroupMode={onToggle}
        soloParty={2}
        onSoloPartyChange={noop}
        minScore={74}
        onMinScoreChange={noop}
        days={[
          { date: "2026-07-21", label: "Tue 21 Jul", count: 2 },
          { date: "2026-07-22", label: "Wed 22 Jul", count: 4 },
        ]}
        onDayCountChange={noop}
        onSkipToResults={noop}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Plan group" }));
    expect(onToggle).toHaveBeenCalledWith(true);

    rerender(
      <ContextBar
        groupMode={true}
        onToggleGroupMode={onToggle}
        soloParty={2}
        onSoloPartyChange={noop}
        minScore={74}
        onMinScoreChange={noop}
        days={[
          { date: "2026-07-21", label: "Tue 21 Jul", count: 2 },
          { date: "2026-07-22", label: "Wed 22 Jul", count: 4 },
        ]}
        onDayCountChange={noop}
        onSkipToResults={noop}
      />,
    );
    expect(screen.getByText("Tue 21 Jul")).toBeInTheDocument();
    expect(screen.getByText("Wed 22 Jul")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Increase Wed 22 Jul headcount" }),
    ).toBeInTheDocument();
  });

  it("stepper +/- buttons call onDayCountChange with the adjusted count, never a slider", () => {
    const onDayCountChange = vi.fn();
    render(
      <ContextBar
        groupMode={true}
        onToggleGroupMode={noop}
        soloParty={2}
        onSoloPartyChange={noop}
        minScore={74}
        onMinScoreChange={noop}
        days={[{ date: "2026-07-21", label: "Tue 21 Jul", count: 6 }]}
        onDayCountChange={onDayCountChange}
        onSkipToResults={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Increase Tue 21 Jul headcount" }));
    expect(onDayCountChange).toHaveBeenCalledWith("2026-07-21", 7);
    fireEvent.click(screen.getByRole("button", { name: "Decrease Tue 21 Jul headcount" }));
    expect(onDayCountChange).toHaveBeenCalledWith("2026-07-21", 5);
    expect(document.querySelector('input[type="range"][aria-label*="Tue"]')).toBeNull();
  });

  it("skip-to-results affordance is present and invokes the callback", () => {
    const onSkip = vi.fn();
    render(
      <ContextBar
        groupMode={false}
        onToggleGroupMode={noop}
        soloParty={2}
        onSoloPartyChange={noop}
        minScore={74}
        onMinScoreChange={noop}
        days={[]}
        onDayCountChange={noop}
        onSkipToResults={onSkip}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /skip to results/i }));
    expect(onSkip).toHaveBeenCalled();
  });
});
