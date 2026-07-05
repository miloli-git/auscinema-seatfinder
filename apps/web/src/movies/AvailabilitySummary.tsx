// Movie header summary (docs/47b-contract.md §6) — "Earliest 2 good seats: Tue 16 Jul (14 days
// out) · 81% sold/held as of 2h ago", rendered on the option-list screen for the selected movie.
// Self-fetching (mirrors OptionSeatMapPanel's own fetch-on-mount shape) so MovieFirstView doesn't
// need a second parallel-state-machine copy of the /options fetch orchestration for this one line.

import { useEffect, useRef, useState } from "react";
import { fetchAvailability as apiFetchAvailability, type AvailabilityQuery } from "./api";
import { fetchGroupAvailability } from "./availabilityGroup";
import { composeHeaderSummary } from "./availabilityPresent";
import type { AvailabilityResponse } from "./types";

interface Props {
  movieKey: string;
  /** True in Plan-group mode. */
  groupMode: boolean;
  /** Per-day headcounts (group mode) — pass an empty map for solo mode, or before any day counts
   *  have been seeded, to get the same single-call behaviour as before this fix. */
  dayCounts: ReadonlyMap<string, number>;
  /** Party used when there's nothing to fan out over: solo mode, or group mode with a single
   *  distinct headcount / no seeded counts yet (debouncedEffectiveParty upstream). */
  fallbackParty: number;
  minScore: number;
  /** Injectable for tests; defaults to the live /availability call. */
  fetchAvailability?: (q: AvailabilityQuery) => Promise<AvailabilityResponse>;
}

type State =
  | { status: "loading" }
  | { status: "ready"; data: AvailabilityResponse; variesByDay: boolean; earliestParty: number | null }
  | { status: "error" };

export function AvailabilitySummary({
  movieKey,
  groupMode,
  dayCounts,
  fallbackParty,
  minScore,
  fetchAvailability = apiFetchAvailability,
}: Props) {
  const [state, setState] = useState<State>({ status: "loading" });
  const reqRef = useRef(0);

  useEffect(() => {
    let live = true;
    const token = ++reqRef.current;
    setState({ status: "loading" });
    // 47c-followup: group mode with varying per-day headcounts fans out one /availability call per
    // distinct headcount and merges honestly — see availabilityGroup.ts. Solo mode / uniform counts
    // keep the original single-call shape unchanged.
    fetchGroupAvailability({ movieKey, minScore }, groupMode ? dayCounts : EMPTY_DAY_COUNTS, fallbackParty, fetchAvailability)
      .then(({ data, variesByDay, earliestParty }) => {
        if (live && reqRef.current === token) setState({ status: "ready", data, variesByDay, earliestParty });
      })
      .catch(() => {
        // Supplementary summary line — a failed fetch here should never block the option list
        // itself; just omit the line rather than throwing a banner on top of a working screen.
        if (live && reqRef.current === token) setState({ status: "error" });
      });
    return () => {
      live = false;
    };
  }, [movieKey, groupMode, dayCounts, fallbackParty, minScore, fetchAvailability]);

  if (state.status === "loading") {
    return (
      <p className="movieforward__availability hint" role="status">
        Checking availability…
      </p>
    );
  }
  if (state.status === "error") return null;

  return (
    <p className="movieforward__availability">
      {composeHeaderSummary(state.data, undefined, {
        variesByDay: state.variesByDay,
        earliestParty: state.earliestParty,
      })}
    </p>
  );
}

// Stable reference so solo-mode renders (which don't have day counts to fan out over) never
// retrigger the fetch effect merely because MovieFirstView's real dayCounts Map reference changed
// in the background (it seeds dayCounts even in solo mode — see MovieFirstView's own comment).
const EMPTY_DAY_COUNTS: ReadonlyMap<string, number> = new Map();
