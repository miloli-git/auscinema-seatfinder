import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SessionCard } from "./SessionCard";
import type { RankedSession, ScreenFormat } from "../types";

function ranked(format: ScreenFormat): RankedSession {
  return {
    session: {
      chain: "event",
      id: `session-${format.kind}-${format.raw || "blank"}`,
      movieId: "movie-1",
      movieName: "Example Movie",
      cinemaId: "cinema-1",
      cinemaName: "Example Cinema",
      startTime: "2026-07-21T19:00",
      format,
      screenName: "4",
      seatsAvailable: 42,
      seatAllocation: true,
      bookingUrl: "https://example.test/book",
    },
    bestScore: 91,
    bookingUrl: "https://example.test/book",
    topSeats: [],
  };
}

describe("SessionCard format badge", () => {
  it("renders an IMAX format badge with the stable data hook", () => {
    const { container } = render(
      <SessionCard
        ranked={ranked({ kind: "imax", raw: "IMAX" })}
        selected={false}
        onSelect={() => {}}
      />,
    );

    const chip = container.querySelector('[data-format="imax"]');
    expect(chip).not.toBeNull();
    expect(chip).toHaveTextContent("IMAX");
    expect(chip).toHaveAttribute("data-premium", "true");
  });

  it("renders no format chip for a standard ranked session", () => {
    const { container, queryByText } = render(
      <SessionCard
        ranked={ranked({ kind: "standard", raw: "Standard" })}
        selected={false}
        onSelect={() => {}}
      />,
    );

    expect(container.querySelector("[data-format]")).toBeNull();
    expect(queryByText("Standard")).not.toBeInTheDocument();
  });
});
