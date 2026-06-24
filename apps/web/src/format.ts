import type { ScreenFormat, Session } from "./types";

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

/** Map a 0–100 score to a colour band class. */
export function scoreBand(score: number): "elite" | "good" | "ok" | "weak" {
  if (score >= 85) return "elite";
  if (score >= 70) return "good";
  if (score >= 50) return "ok";
  return "weak";
}
