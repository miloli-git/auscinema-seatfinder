/**
 * Chain-agnostic domain types. Every adapter normalises its chain's raw payloads
 * into these shapes. Scoring and UI depend only on this module.
 */

export type Chain = "event" | "hoyts" | "reading" | "village";

/** A physical cinema location. */
export interface Cinema {
  chain: Chain;
  /** Chain-native id, as a string (Event uses numeric ids; keep as string for portability). */
  id: string;
  name: string;
  /** State/region if the chain exposes it (e.g. "NSW"). */
  region?: string;
  /** Canonical page for the cinema, if known. */
  url?: string;
}

/** Premium-format tier of a screen, normalised across chains. Free-form `raw` preserved. */
export interface ScreenFormat {
  /** Normalised bucket used by scoring/filtering. */
  kind: "standard" | "premium" | "goldclass" | "imax" | "vmax" | "other";
  /** Chain's own label, e.g. "V-Max", "Gold Class", "Titan XC". */
  raw: string;
}

/** A single screening of a movie. */
export interface Session {
  chain: Chain;
  /** Chain-native session id (string). Used to fetch the seat map. */
  id: string;
  movieId: string;
  movieName: string;
  cinemaId: string;
  cinemaName: string;
  /** Local start time, ISO 8601 without timezone offset as provided by the chain (e.g. "2026-07-21T09:30"). */
  startTime: string;
  format: ScreenFormat;
  /** Auditorium label, e.g. "7". */
  screenName?: string;
  /** Live count of seats free, if the listing exposes it. */
  seatsAvailable?: number;
  /** False = unallocated/first-come; seat selection is skipped. */
  seatAllocation: boolean;
  /** Deep-link to the chain's own booking flow for this session. */
  bookingUrl: string;
  /** Raw chain attribute codes (e.g. "NFT", "Recliner"). */
  attributes?: string[];
}

export type SeatStatus =
  | "available"
  | "sold"
  | "spacer" // structural gap / aisle — not a seat
  | "companion"
  | "special"
  | "unavailable";

/** A seating area / price class within an auditorium (e.g. Recliner, Gold Class, Daybed). */
export interface SeatArea {
  /** Chain-native area id (string). */
  id: string;
  name: string;
  /** Chain's short code, e.g. "club", "suite". */
  code?: string;
  /** Normalised class bucket used by scoring/filtering. */
  kind: "standard" | "recliner" | "premium" | "goldclass" | "daybed" | "companion" | "other";
}

/** A single seat with its normalised physical grid position. */
export interface Seat {
  /** Chain-native seat id, opaque, passed straight back into the booking flow. */
  id: string;
  /** Human label, e.g. "A1". */
  name?: string;
  /** Row label as printed, e.g. "A". */
  rowLabel: string;
  /**
   * Normalised physical coordinates. Higher `row` = further back from the screen;
   * `col` increases left->right. Adapters derive these from the chain's raw layout so
   * scoring is geometry-correct regardless of source encoding.
   */
  row: number;
  col: number;
  status: SeatStatus;
  areaId: string;
  /** Couple/loveseat or otherwise paired seat. */
  paired?: boolean;
  /** Premium/platinum flag where the chain marks it. */
  premium?: boolean;
  /** Accessible seat (wheelchair space etc.). */
  accessible?: boolean;
}

/** Full auditorium layout + live availability for one session. */
export interface SeatMap {
  chain: Chain;
  sessionId: string;
  screenName?: string;
  areas: SeatArea[];
  /** All real + structural seats. Use `row`/`col` for geometry; filter `status==="spacer"` out. */
  seats: Seat[];
}
