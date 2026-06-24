#!/usr/bin/env node
/**
 * Watcher CLI. Two modes:
 *
 *   auscinema-watch check [configPath]   single-shot - the NAS-cron entrypoint
 *   auscinema-watch watch [configPath]   loop on pollIntervalMs, backing off on errors
 *
 * Config path resolution: argv[3] -> $WATCHER_CONFIG -> ./watch.config.json
 * Webhook resolution:      $WATCHER_WEBHOOK -> config.notifier.webhookUrl -> console
 */
import { pathToFileURL } from "node:url";
import { loadConfig, type WatcherConfig } from "./config.js";
import { defaultRegistry } from "./registry.js";
import { loadState, saveState } from "./state.js";
import { WebhookNotifier, ConsoleNotifier, type Notifier } from "./notifier.js";
import { runCheck, type CheckResult } from "./check.js";

const DEFAULT_CONFIG = "watch.config.json";
const DEFAULT_STATE = "watch.state.json";
const DEFAULT_INTERVAL_MS = 5 * 60_000;

interface CheckCycle {
  result: CheckResult;
  totalWatches: number;
}

function resolveConfigPath(argv: string[]): string {
  return argv[3] ?? process.env.WATCHER_CONFIG ?? DEFAULT_CONFIG;
}

function buildNotifier(config: WatcherConfig): Notifier {
  const webhook = process.env.WATCHER_WEBHOOK ?? config.notifier?.webhookUrl;
  return webhook ? new WebhookNotifier(webhook) : new ConsoleNotifier();
}

export function resolveStatePath(config: WatcherConfig): string {
  return process.env.WATCHER_STATE_PATH ?? config.statePath ?? DEFAULT_STATE;
}

function failingWatchCount(result: CheckResult): number {
  return new Set(result.errors.map((e) => e.watchId)).size;
}

export function shouldBackoffForCheckResult(result: CheckResult, totalWatches: number): boolean {
  if (totalWatches <= 0) return false;
  const failed = failingWatchCount(result);
  return failed === totalWatches || failed > totalWatches / 2;
}

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

/** Run all watches once, persisting state and reporting a summary. */
async function doCheck(configPath: string): Promise<CheckCycle> {
  const config = await loadConfig(configPath);
  const statePath = resolveStatePath(config);
  const registry = defaultRegistry();
  const notifier = buildNotifier(config);
  const state = await loadState(statePath);

  const result = await runCheck(config, { registry, notifier, state });
  await saveState(statePath, state);

  log(`check: ${result.hits.length} hit(s), ${result.newHits.length} new, ${result.errors.length} error(s)`);
  for (const e of result.errors) {
    const subject = e.sessionId ? `watch ${e.watchId} session ${e.sessionId}` : `watch ${e.watchId}`;
    log(`  ${subject} error: ${e.error}`);
  }
  return { result, totalWatches: config.watches.length };
}

/** Loop doCheck on the configured interval, with exponential backoff on failure. */
async function doWatch(configPath: string): Promise<never> {
  // Read interval once up front (config is re-read each cycle for the rest).
  const baseInterval = (await loadConfig(configPath)).pollIntervalMs ?? DEFAULT_INTERVAL_MS;
  const maxBackoff = baseInterval * 8;
  let backoff = baseInterval;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const cycle = await doCheck(configPath);
      if (shouldBackoffForCheckResult(cycle.result, cycle.totalWatches)) {
        const failed = failingWatchCount(cycle.result);
        log(`check failed for ${failed}/${cycle.totalWatches} watch(es); backing off ${Math.round(backoff / 1000)}s`);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, maxBackoff);
        continue;
      }
      backoff = baseInterval; // reset on success
    } catch (err) {
      log(`check failed: ${(err as Error).message}; backing off ${Math.round(backoff / 1000)}s`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, maxBackoff);
      continue;
    }
    await sleep(baseInterval);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  const configPath = resolveConfigPath(process.argv);
  if (mode === "check") {
    await doCheck(configPath);
    return;
  }
  if (mode === "watch") {
    await doWatch(configPath);
    return;
  }
  console.error("usage: auscinema-watch <check|watch> [configPath]");
  process.exitCode = 2;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`fatal: ${(err as Error).message}`);
    process.exit(1);
  });
}
