/**
 * Watcher configuration: one or more saved seat-watches plus globals.
 *
 * Loaded from a JSON file (see watch.config.json.example). Validated leniently -
 * enough to fail fast with a clear message, not a full schema engine.
 */
import { readFile } from "node:fs/promises";
import type { Chain, SeatPreference } from "@auscinema/core";

/** A time-of-day window, inclusive, as zero-padded "HH:MM" local strings. */
export interface TimeWindow {
  from: string;
  to: string;
}

export type AlertMode = "seat-available" | "new-session";

interface WatchBase {
  /** Stable id, used as the de-dupe namespace for this watch. */
  id: string;
  chain: Chain;
  movieId: string;
  cinemaIds: string[];
  /** Optional local start-time window; sessions outside it are ignored. */
  timeWindow?: TimeWindow;
  /** Human label used in notifications. Defaults to the id. */
  label?: string;
}

/** Existing mode: alert when a qualifying seat becomes available on one business date. */
export interface SeatAvailabilityWatch extends WatchBase {
  /** Omitted for backwards compatibility; `seat-available` is the default. */
  alertOn?: "seat-available";
  /** Business date, "YYYY-MM-DD". */
  date: string;
  /** Seat-scoring preference passed to rankSeats. */
  preference: SeatPreference;
  /** Alert only when an available seat scores >= this (0–100). */
  minScore: number;
}

/** Discovery mode: alert when a session id appears after a date has been baselined. */
export interface NewSessionWatch extends WatchBase {
  alertOn: "new-session";
  /** Require a positive live seat count and valid HTTPS booking URL before considering a session. */
  requirePurchasable?: boolean;
  /** Monitor one fixed business date. Mutually exclusive with `lookaheadDays`. */
  date?: string;
  /** Rolling days after today to scan (0 = today only, maximum 90). */
  lookaheadDays?: number;
}

export type Watch = SeatAvailabilityWatch | NewSessionWatch;

/** Notifier settings. `webhookUrl` is overridden by the WATCHER_WEBHOOK env var. */
export interface NotifierConfig {
  /** POST target for the generic webhook notifier (Discord/ntfy/Slack-style). */
  webhookUrl?: string;
}

export interface WatcherConfig {
  /** Loop interval for `watch` mode, milliseconds. Default 5 minutes. */
  pollIntervalMs?: number;
  /** IANA zone used to resolve "today" for rolling new-session watches. Default Australia/Sydney. */
  timeZone?: string;
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

function validateDate(value: unknown, where: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${where} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(`${where} must be a real date`);
  return value;
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
  let timeWindow: TimeWindow | undefined;
  if (w.timeWindow !== undefined) {
    const tw = w.timeWindow as Record<string, unknown>;
    if (typeof tw.from !== "string" || typeof tw.to !== "string") fail(`${at("timeWindow")} needs from/to "HH:MM"`);
    timeWindow = { from: tw.from, to: tw.to };
  }

  const base = {
    id: w.id,
    chain: w.chain as Chain,
    movieId: w.movieId,
    cinemaIds,
    ...(timeWindow ? { timeWindow } : {}),
    ...(typeof w.label === "string" ? { label: w.label } : {}),
  };

  const alertOn = w.alertOn ?? "seat-available";
  if (alertOn === "new-session") {
    if (w.requirePurchasable !== undefined && typeof w.requirePurchasable !== "boolean") {
      fail(`${at("requirePurchasable")} must be a boolean`);
    }
    const purchaseRequirement =
      typeof w.requirePurchasable === "boolean" ? { requirePurchasable: w.requirePurchasable } : {};
    const hasDate = w.date !== undefined;
    const hasLookahead = w.lookaheadDays !== undefined;
    if (hasDate === hasLookahead) fail(`${at("date")} or ${at("lookaheadDays")} is required (choose one)`);
    if (hasDate) return { ...base, alertOn, ...purchaseRequirement, date: validateDate(w.date, at("date")) };
    if (
      typeof w.lookaheadDays !== "number" ||
      !Number.isInteger(w.lookaheadDays) ||
      w.lookaheadDays < 0 ||
      w.lookaheadDays > 90
    ) {
      fail(`${at("lookaheadDays")} must be an integer from 0 to 90`);
    }
    return { ...base, alertOn, ...purchaseRequirement, lookaheadDays: w.lookaheadDays };
  }

  if (alertOn !== "seat-available") fail(`${at("alertOn")} unknown: ${String(alertOn)}`);
  const date = validateDate(w.date, at("date"));
  if (typeof w.minScore !== "number" || !Number.isFinite(w.minScore)) fail(`${at("minScore")} must be a number`);
  const preference = (w.preference ?? {}) as SeatPreference;
  if (typeof preference !== "object" || preference === null) fail(`${at("preference")} must be an object`);
  return { ...base, ...(w.alertOn === "seat-available" ? { alertOn } : {}), date, preference, minScore: w.minScore };
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
  if (c.timeZone !== undefined) {
    if (typeof c.timeZone !== "string" || c.timeZone.trim() === "") fail("timeZone must be an IANA time-zone name");
    try {
      new Intl.DateTimeFormat("en-AU", { timeZone: c.timeZone }).format();
    } catch {
      fail(`timeZone unknown: ${c.timeZone}`);
    }
    cfg.timeZone = c.timeZone;
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
    throw new Error(`watcher config: cannot read ${path}: ${(err as Error).message}`, { cause: err });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`watcher config: ${path} is not valid JSON: ${(err as Error).message}`, { cause: err });
  }
  return validateConfig(parsed);
}
