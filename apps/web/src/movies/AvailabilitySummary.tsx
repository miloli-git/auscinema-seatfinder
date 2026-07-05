// Movie header summary (docs/47b-contract.md §6) — "Earliest 2 good seats: Tue 16 Jul (14 days
// out) · 81% sold/held as of 2h ago", rendered on the option-list screen for the selected movie.
// Self-fetching (mirrors OptionSeatMapPanel's own fetch-on-mount shape) so MovieFirstView doesn't
// need a second parallel-state-machine copy of the /options fetch orchestration for this one line.

import { useEffect, useRef, useState } from "react";
import { fetchAvailability as apiFetchAvailability, type AvailabilityQuery } from "./api";
import { composeHeaderSummary } from "./availabilityPresent";
import type { AvailabilityResponse } from "./types";

interface Props {
  movieKey: string;
  party: number;
  minScore: number;
  /** Injectable for tests; defaults to the live /availability call. */
  fetchAvailability?: (q: AvailabilityQuery) => Promise<AvailabilityResponse>;
}

type State =
  | { status: "loading" }
  | { status: "ready"; data: AvailabilityResponse }
  | { status: "error" };

export function AvailabilitySummary({
  movieKey,
  party,
  minScore,
  fetchAvailability = apiFetchAvailability,
}: Props) {
  const [state, setState] = useState<State>({ status: "loading" });
  const reqRef = useRef(0);

  useEffect(() => {
    let live = true;
    const token = ++reqRef.current;
    setState({ status: "loading" });
    fetchAvailability({ movieKey, party, minScore })
      .then((data) => {
        if (live && reqRef.current === token) setState({ status: "ready", data });
      })
      .catch(() => {
        // Supplementary summary line — a failed fetch here should never block the option list
        // itself; just omit the line rather than throwing a banner on top of a working screen.
        if (live && reqRef.current === token) setState({ status: "error" });
      });
    return () => {
      live = false;
    };
  }, [movieKey, party, minScore, fetchAvailability]);

  if (state.status === "loading") {
    return (
      <p className="movieforward__availability hint" role="status">
        Checking availability…
      </p>
    );
  }
  if (state.status === "error") return null;

  return <p className="movieforward__availability">{composeHeaderSummary(state.data)}</p>;
}
