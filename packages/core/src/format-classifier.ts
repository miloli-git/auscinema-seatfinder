/**
 * Server-side format classifier over the FLATTENED `sessions.format` string (#47a contract §1.4).
 *
 * `sessions.format` is `session.format.raw || session.format.kind` at ingestion
 * (packages/ingester/src/sweep.ts `sessionToUpsert`) — the structured `{kind, raw}` ScreenFormat is
 * discarded. `apps/web/src/format.ts`'s rank/large-format helpers take the structured object, so
 * `/options` cannot forward that column and expect the client to reuse `format.ts` unmodified.
 * This classifier is a heuristic over the lossy flattened string, specified verbatim by the contract
 * — do not "improve" it without re-checking the contract, since the web builder tests against this
 * exact behaviour too.
 */

/** 2 = IMAX, 1 = Vmax/Xtremescreen/other-large-format, 0 = standard/unknown. */
export type FormatRank = 0 | 1 | 2;

export interface FormatClassification {
  formatRank: FormatRank;
  isLargeFormat: boolean;
}

export function classifyFormat(raw: string): FormatClassification {
  const s = raw.trim().toLowerCase();
  if (s === "" || s === "standard") return { formatRank: 0, isLargeFormat: false };
  if (s === "imax") return { formatRank: 2, isLargeFormat: true };
  if (s.includes("vmax") || s.includes("v-max") || s.includes("xtreme")) {
    return { formatRank: 1, isLargeFormat: true };
  }
  // Any other non-empty, non-standard label (goldclass, premium, titan xc, unknown "other" with a raw
  // label) — mirrors format.ts's isLargeFormat rule for kind="other": non-empty raw = large format.
  return { formatRank: 1, isLargeFormat: true };
}
