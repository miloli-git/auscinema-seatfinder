/**
 * Watcher configuration: one or more saved seat-watches plus globals.
 *
 * Loaded from a JSON file (see watch.config.json.example). Validated leniently —
 * enough to fail fast with a clear message, not a full schema engine.
 */
import { readFile } from "node:fs/promises";
import type { Chain, SeatPreference } from "@auscinema/core";

/** A time-of-day window, inclusive, as zero-padded "HH:MM" local strings. */
export interface TimeWindow {
  from: string;
  to: string;
}

/** One saved watch: a movie at given cinemas on a date, with a quality threshold. */
export interface Watch {
  /** Stable id, used as the de-dupe namespace for this watch. */
  id: string;
  chain: Chain;
  movieId: string;
  cinemaIds: string[];
  /** Business date, "YYYY-MM-DD". */
  date: string;
  /** Optional local start-time window; sessions outside it are ignored. */
  timeWindow?: TimeWindow;
  /** Seat-scoring preference passed to rankSeats. */
  preference: SeatPreference;
  /** Alert only when an available seat scores >= this (0–100). */
  minScore: number;
  /** Human label used in notifications. Defaults to the id. */
  label?: string;
}

/** Notifier settings. `webhookUrl` is overridden by the WATCHER_WEBHOOK env var. */
export interface NotifierConfig {
  /** POST target for the generic webhook notifier (Discord/ntfy/Slack-style). */
  webhookUrl?: string;
}

export interface WatcherConfig {
  /** Loop interval for `watch` mode, milliseconds. Default 5 minutes. */
  pollIntervalMs?: number;
  /** Max concurrent seat-map fetches per check. Default 4. */
  concurrency?: number;
  /** Where to persist already-alerted hits. Default "watch.state.json". */
  statePath?: string;
  notifier?: NotifierConfig;
  watches: Watch[];
}

const KNOWN_CHAINS: ReadonlySet<string> = new Set<Chain>(["event", "hoyts", "reading", "village"]);

function fail(msg: string): never {
  throw new Error(`watcher config: ${msg}`);
}

function asArray(v: unknown, where: string): unknown[] {
  if (!Array.isArray(v)) fail(`${where} must be an array`);
  return v;
}

function validateWatch(raw: unknown, i: number): Watch {
  if (typeof raw !== "object" || raw === null) fail(`watches[${i}] must be an object`);
  const w = raw as Record<string, unknown>;
  const at = (k: string) => `watches[${i}].${k}`;

  if (typeof w.id !== "string" || w.id.trim() === "") fail(`${at("id")} required`);
  if (typeof w.chain !== "string" || !KNOWN_CHAINS.has(w.chain)) fail(`${at("chain")} unknown: ${String(w.chain)}`);
  if (typeof w.movieId !== "string" || w.movieId.trim() === "") fail(`${at("movieId")} required`);
  const cinemaIds = asArray(w.cinemaIds, at("cinemaIds")).map((c) => String(c));
  if (cinemaIds.length === 0) fail(`${at("cinemaIds")} must be non-empty`);
  if (typeof w.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(w.date)) fail(`${at("date")} must be YYYY-MM-DD`);
  if (typeof w.minScore !== "number" || !Number.isFinite(w.minScore)) fail(`${at("minScore")} must be a number`);

  let timeWindow: TimeWindow | undefined;
  if (w.timeWindow !== undefined) {
    const tw = w.timeWindow as Record<string, unknown>;
    if (typeof tw.from !== "string" || typeof tw.to !== "string") fail(`${at("timeWindow")} needs from/to "HH:MM"`);
    timeWindow = { from: tw.from, to: tw.to };
  }

  const preference = (w.preference ?? {}) as SeatPreference;
  if (typeof preference !== "object" || preference === null) fail(`${at("preference")} must be an object`);

  return {
    id: w.id,
    chain: w.chain as Chain,
    movieId: w.movieId,
    cinemaIds,
    date: w.date,
    ...(timeWindow ? { timeWindow } : {}),
    preference,
    minScore: w.minScore,
    ...(typeof w.label === "string" ? { label: w.label } : {}),
  };
}

/** Validate a parsed config object, throwing on the first problem. */
export function validateConfig(raw: unknown): WatcherConfig {
  if (typeof raw !== "object" || raw === null) fail("root must be an object");
  const c = raw as Record<string, unknown>;
  const watches = asArray(c.watches, "watches").map(validateWatch);
  if (watches.length === 0) fail("watches must be non-empty");

  const cfg: WatcherConfig = { watches };
  if (c.pollIntervalMs !== undefined) {
    if (typeof c.pollIntervalMs !== "number" || c.pollIntervalMs <= 0) fail("pollIntervalMs must be a positive number");
    cfg.pollIntervalMs = c.pollIntervalMs;
  }
  if (c.concurrency !== undefined) {
    if (typeof c.concurrency !== "number" || c.concurrency <= 0) fail("concurrency must be a positive number");
    cfg.concurrency = c.concurrency;
  }
  if (c.statePath !== undefined) {
    if (typeof c.statePath !== "string") fail("statePath must be a string");
    cfg.statePath = c.statePath;
  }
  if (c.notifier !== undefined) {
    const n = c.notifier as Record<string, unknown>;
    cfg.notifier = {};
    if (n.webhookUrl !== undefined) {
      if (typeof n.webhookUrl !== "string") fail("notifier.webhookUrl must be a string");
      cfg.notifier.webhookUrl = n.webhookUrl;
    }
  }
  return cfg;
}

/** Read + parse + validate a config file. */
export async function loadConfig(path: string): Promise<WatcherConfig> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    throw new Error(`watcher config: cannot read ${path}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`watcher config: ${path} is not valid JSON: ${(err as Error).message}`);
  }
  return validateConfig(parsed);
}
