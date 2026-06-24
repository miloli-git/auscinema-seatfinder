import type { Chain, ScreenFormat, Session } from "./types";

/** "2026-07-21T09:30" -> "9:30 AM". Falls back to the raw value if unparseable. */
export function formatTime(startTime: string): string {
  const t = startTime.split("T")[1];
  if (!t) return startTime;
  const [hStr, mStr] = t.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return startTime;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** "2026-07-21T09:30" -> "09:30" for client-side time-window comparisons. */
export function timeHHMM(startTime: string): string | undefined {
  const t = startTime.split("T")[1];
  if (!t) return undefined;
  const [h, m] = t.split(":");
  if (h === undefined || m === undefined) return undefined;
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
}

/** True if a session's start falls inside an inclusive [from, to] window. Blank bounds = open. */
export function withinWindow(
  session: Session,
  from: string,
  to: string,
): boolean {
  const hhmm = timeHHMM(session.startTime);
  if (!hhmm) return true;
  if (from && hhmm < from) return false;
  if (to && hhmm > to) return false;
  return true;
}

const FORMAT_LABEL: Record<ScreenFormat["kind"], string> = {
  standard: "Standard",
  premium: "Premium",
  goldclass: "Gold Class",
  imax: "IMAX",
  vmax: "V-Max",
  other: "Other",
};

export function formatLabel(f: ScreenFormat): string {
  return f.raw?.trim() || FORMAT_LABEL[f.kind];
}

const CHAIN_LABEL: Record<Chain, string> = {
  event: "Event Cinemas",
  hoyts: "Hoyts",
  reading: "Reading",
  village: "Village",
};

export function chainLabel(chain: Chain): string {
  return CHAIN_LABEL[chain];
}

/** Session score pill band (3 readable tiers for the ranked rail). */
export function scoreBand(score: number): "elite" | "great" | "good" {
  if (score >= 85) return "elite";
  if (score >= 70) return "great";
  return "good";
}

/**
 * Seat-quality bucket for the heatmap. Five discrete steps read far better than a continuous
 * blue->green lerp (the v0 problem: every available seat looked the same green). Maps to the
 * --q-* tokens via a `data-q` attribute.
 */
export function seatQuality(score: number): "elite" | "great" | "good" | "ok" | "weak" {
  if (score >= 88) return "elite";
  if (score >= 74) return "great";
  if (score >= 58) return "good";
  if (score >= 40) return "ok";
  return "weak";
}
