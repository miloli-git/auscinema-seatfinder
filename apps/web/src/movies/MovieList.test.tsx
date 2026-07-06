import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MovieList } from "./MovieList";
import type { CatalogTitle } from "./types";

const TITLES: CatalogTitle[] = [
  {
    movieKey: "event:555",
    chain: "event",
    title: "Dune: Part Two",
    sessionCount: 12,
    posterUrl: "https://cdn.eventcinemas.com.au/poster.jpg",
  },
  { movieKey: "village:555", chain: "village", title: "dune: part two", sessionCount: 4, posterUrl: null },
  { movieKey: "hoyts:900", chain: "hoyts", title: "The Odyssey", sessionCount: 6, posterUrl: null },
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
    const blank: CatalogTitle[] = [
      { movieKey: "hoyts:HO00010001", chain: "hoyts", title: "", sessionCount: 3, posterUrl: null },
    ];
    render(<MovieList titles={blank} onSelect={vi.fn()} />);
    expect(screen.getByText("Untitled (Hoyts)")).toBeInTheDocument();
    expect(screen.queryByText(/HO00010001/)).toBeNull();
  });

  // SOH poster-card design brief: image on top when the group has one, first entry's poster wins
  // for a multi-chain group.
  it("renders a poster <img> for a group whose first entry has a posterUrl", () => {
    render(<MovieList titles={TITLES} onSelect={vi.fn()} />);
    const srcs = Array.from(document.querySelectorAll("img")).map((img) => img.getAttribute("src"));
    expect(srcs).toContain(TITLES[0]!.posterUrl);
  });

  // No poster anywhere in the group -> colour-block placeholder fills the card, never a broken <img>.
  it("renders no <img> for a title with no cached poster (colour-block placeholder)", () => {
    render(<MovieList titles={TITLES} onSelect={vi.fn()} />);
    const odysseyRow = screen.getByRole("button", { name: /The Odyssey/ });
    expect(odysseyRow.querySelector("img")).toBeNull();
  });

  // Sort control (movielist-posters-sort): "Most sessions" (total sessionCount desc) is the
  // default; "A-Z" reorders by displayTitle. Both are pure sorts over the SAME visible list.
  it("defaults to 'Most sessions' order, and 'A-Z' reorders the list", () => {
    render(<MovieList titles={TITLES} onSelect={vi.fn()} />);
    const titleOf = (el: Element) => el.textContent ?? "";
    const rowsInOrder = () => Array.from(document.querySelectorAll(".postercard__title")).map(titleOf);

    // Dune group (12+4=16) outranks The Odyssey (6) by total sessionCount.
    expect(rowsInOrder()).toEqual(["Dune: Part Two", "The Odyssey"]);

    fireEvent.click(screen.getByRole("button", { name: "A–Z" }));
    expect(rowsInOrder()).toEqual(["Dune: Part Two", "The Odyssey"]); // D before T alphabetically too

    fireEvent.click(screen.getByRole("button", { name: "Most sessions" }));
    expect(rowsInOrder()).toEqual(["Dune: Part Two", "The Odyssey"]);
  });

  it("'A-Z' actually changes order when session-count order and alphabetical order disagree", () => {
    const titles: CatalogTitle[] = [
      { movieKey: "event:1", chain: "event", title: "Zeta", sessionCount: 20, posterUrl: null },
      { movieKey: "event:2", chain: "event", title: "Alpha", sessionCount: 1, posterUrl: null },
    ];
    render(<MovieList titles={titles} onSelect={vi.fn()} />);
    const titleOf = (el: Element) => el.textContent ?? "";
    const rowsInOrder = () => Array.from(document.querySelectorAll(".postercard__title")).map(titleOf);

    expect(rowsInOrder()).toEqual(["Zeta", "Alpha"]); // default: most sessions first
    fireEvent.click(screen.getByRole("button", { name: "A–Z" }));
    expect(rowsInOrder()).toEqual(["Alpha", "Zeta"]);
  });
});
