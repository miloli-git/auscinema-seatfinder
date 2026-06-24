/**
 * Chain -> adapter registry. Adapters are constructed in-process (no HTTP API hop).
 * event + hoyts are wired today; reading/village slot in when their adapters land.
 */
import type { Chain, ChainAdapter } from "@auscinema/core";
import { EventCinemasAdapter } from "@auscinema/adapter-event";
import { HoytsAdapter } from "@auscinema/adapter-hoyts";

export type AdapterRegistry = Partial<Record<Chain, ChainAdapter>>;

/** Default registry with the live adapters wired. */
export function defaultRegistry(): AdapterRegistry {
  return {
    event: new EventCinemasAdapter(),
    hoyts: new HoytsAdapter(),
  };
}

/** Resolve a chain to its adapter, erroring clearly when unwired/unknown. */
export function resolveAdapter(registry: AdapterRegistry, chain: Chain): ChainAdapter {
  const adapter = registry[chain];
  if (!adapter) {
    const wired = Object.keys(registry).join(", ") || "(none)";
    throw new Error(`no adapter for chain "${chain}" (wired: ${wired})`);
  }
  return adapter;
}
