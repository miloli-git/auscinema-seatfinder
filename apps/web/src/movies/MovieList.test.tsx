import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MovieList } from "./MovieList";
import type { CatalogTitle } from "./types";

const TITLES: CatalogTitle[] = [
  { movieKey: "event:555", chain: "event", title: "Dune: Part Two", sessionCount: 12 },
  { movieKey: "village:555", chain: "village", title: "dune: part two", sessionCount: 4 },
  { movieKey: "hoyts:900", chain: "hoyts", title: "The Odyssey", sessionCount: 6 },
];

describe("MovieList", () => {
  it("groups trivially-equal titles across chains into one row with a chain picker", () => {
    render(<MovieList titles={TITLES} onSelect={vi.fn()} />);
    expect(screen.getAllByText(/Dune: Part Two/i)).toHaveLength(1); // one grouped row, not two
    expect(screen.getByRole("button", { name: /Event Cinemas · 12/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Village · 4/ })).toBeInTheDocument();
  });

  it("shows non-matching titles as their own separate row", () => {
    render(<MovieList titles={TITLES} onSelect={vi.fn()} />);
    expect(screen.getByText("The Odyssey")).toBeInTheDocument();
  });

  it("text search narrows the same list (one surface, not a separate browse toggle)", () => {
    render(<MovieList titles={TITLES} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search a film"), { target: { value: "odyssey" } });
    expect(screen.getByText("The Odyssey")).toBeInTheDocument();
    expect(screen.queryByText(/Dune: Part Two/i)).toBeNull();
  });

  it("picking a chain within a grouped row resolves to that chain's own movieKey", () => {
    const onSelect = vi.fn();
    render(<MovieList titles={TITLES} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Village · 4/ }));
    expect(onSelect).toHaveBeenCalledWith("village:555");
  });

  it("picking a single (ungrouped) title resolves directly", () => {
    const onSelect = vi.fn();
    render(<MovieList titles={TITLES} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /The Odyssey/ }));
    expect(onSelect).toHaveBeenCalledWith("hoyts:900");
  });

  it("shows an honest empty state when the catalog has no titles", () => {
    render(<MovieList titles={[]} onSelect={vi.fn()} />);
    expect(screen.getByText(/no cached titles yet/i)).toBeInTheDocument();
  });

  // #84: a blank cached title used to fall back to the raw movieKey (e.g. "hoyts:HO00010001");
  // it must degrade to an honest, chain-scoped placeholder instead.
  it("never renders the raw movieKey for a blank-titled single entry", () => {
    const blank: CatalogTitle[] = [{ movieKey: "hoyts:HO00010001", chain: "hoyts", title: "", sessionCount: 3 }];
    render(<MovieList titles={blank} onSelect={vi.fn()} />);
    expect(screen.getByText("Untitled (Hoyts)")).toBeInTheDocument();
    expect(screen.queryByText(/HO00010001/)).toBeNull();
  });
});
