import type { Chain, RankedSession, ScreenFormat, Session } from "./types";

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

/**
 * Large-format / premium screening test (#50). True for the explicitly premium kinds, and for an
 * "other" kind that carries a real label (e.g. Xtremescreen, Titan XC). An "other" with empty or
 * whitespace `raw` is an unknown screen and treated as standard.
 */
export function isLargeFormat(f: ScreenFormat): boolean {
  switch (f.kind) {
    case "imax":
    case "vmax":
    case "goldclass":
    case "premium":
      return true;
    case "other":
      return f.raw?.trim().length > 0;
    default:
      return false;
  }
}

/**
 * Badge descriptor for a session's format, or `null` when no chip should render (standard screens,
 * and unknown "other" screens with no label). `label` surfaces the chain's own `raw` verbatim.
 */
export function formatBadge(f: ScreenFormat): { label: string; premium: boolean } | null {
  if (!isLargeFormat(f)) return null;
  return { label: formatLabel(f), premium: true };
}

/** Pure, additive filter: keep only large-format sessions when enabled; pass through unchanged otherwise. */
export function largeFormatOnly(sessions: RankedSession[], enabled: boolean): RankedSession[] {
  if (!enabled) return sessions;
  return sessions.filter((r) => isLargeFormat(r.session.format));
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

const SYDNEY_TZ = "Australia/Sydney";

/**
 * Australia/Sydney "now" as zero-padded { date: "YYYY-MM-DD", time: "HH:MM" } (24h; hourCycle h23 so
 * midnight is "00:00", not the "24:00" some ICU builds emit). `d` is injectable for deterministic tests.
 */
export function sydneyNow(d: Date = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SYDNEY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/**
 * True if a Together session's local showtime is now-or-later in Sydney. `startTime` is a LOCAL
 * wall-time mislabelled with a trailing `Z` (e.g. "2026-06-25T14:00:00.000Z" = 2pm Sydney), so we
 * compare its date/time SUBSTRINGS against Sydney now — we must NOT parse it as a real UTC instant.
 * `now` is injectable for tests.
 *
 * Known limitation (accepted): on the DST fall-back morning (~early April) the 02:00-02:59 wall hour
 * repeats, so a bare wall-time can't say which occurrence it is. Cinemas effectively never schedule
 * 2-3am sessions, so this is immaterial; a true fix needs a real instant/offset from the API.
 */
export function isUpcoming(startTime: string, now: { date: string; time: string } = sydneyNow()): boolean {
  const date = startTime.slice(0, 10);
  if (date !== now.date) return date > now.date;
  return startTime.slice(11, 16) >= now.time;
}

/**
 * Render a TRUE UTC instant (e.g. a session's `fetched_at` "2026-06-25T01:04:17Z") in Sydney local
 * time, e.g. "11:04 am". Distinct from formatTime(), which reads a local-wall-time string as-is and
 * would print the UTC hour (the "as of 1:04 AM" bug, #44).
 */
export function formatInstantSydney(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: SYDNEY_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}
