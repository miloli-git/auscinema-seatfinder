/**
 * Chain -> adapter registry. Mirrors packages/watcher/src/registry.ts (duplicated to keep
 * the ingester decoupled from the watcher package). Adapters run in-process.
 */
import type { Chain, ChainAdapter } from "@auscinema/core";
import { EventCinemasAdapter } from "@auscinema/adapter-event";
import { HoytsAdapter } from "@auscinema/adapter-hoyts";
import { ReadingAdapter } from "@auscinema/adapter-reading";
import { VillageAdapter } from "@auscinema/adapter-village";

export type AdapterRegistry = Partial<Record<Chain, ChainAdapter>>;

/** Default registry with the live adapters wired. */
export function defaultRegistry(): AdapterRegistry {
  return {
    event: new EventCinemasAdapter(),
    hoyts: new HoytsAdapter(),
    reading: new ReadingAdapter(),
    village: new VillageAdapter(),
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
