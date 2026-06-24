/**
 * Pluggable notifications. A "hit" is one available, above-threshold seat for a watch.
 * The webhook notifier POSTs JSON shaped to satisfy Discord (`content`), Slack (`text`)
 * and ntfy (`message`) at once, plus a structured `hits` array for custom consumers.
 */
import type { Chain } from "@auscinema/core";

/** A surfaced seat: above threshold, available, ready to hand to the booking page. */
export interface Hit {
  watchId: string;
  label: string;
  chain: Chain;
  sessionId: string;
  seatId: string;
  seatName?: string;
  score: number;
  /** Local start time, ISO without offset (e.g. "2026-07-21T19:30"). */
  startTime: string;
  /** Chain format label, e.g. "VMAX". */
  format: string;
  /** Deep-link into the chain's own booking flow. */
  bookingUrl: string;
}

export interface Notifier {
  /** Deliver a batch of new hits. Implementations should no-op on an empty batch. */
  notify(hits: Hit[]): Promise<void>;
}

/** One human-readable line per hit. */
export function formatHit(h: Hit): string {
  const seat = h.seatName ?? h.seatId;
  const time = h.startTime.replace("T", " ");
  return `🎬 ${h.label}: seat ${seat} (score ${h.score}, ${h.format}) @ ${time} → ${h.bookingUrl}`;
}

/** Multi-line summary message for a batch. */
export function formatMessage(hits: Hit[]): string {
  if (hits.length === 0) return "";
  const head = hits.length === 1 ? "Seat available" : `${hits.length} seats available`;
  return [head, ...hits.map(formatHit)].join("\n");
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; statusText: string }>;

/**
 * Generic webhook notifier - POSTs JSON to a configurable URL. Compatible with
 * Discord / Slack / ntfy style endpoints and any custom collector.
 */
export class WebhookNotifier implements Notifier {
  constructor(
    private readonly url: string,
    // Default to global fetch; injectable for tests.
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {}

  async notify(hits: Hit[]): Promise<void> {
    if (hits.length === 0) return;
    const message = formatMessage(hits);
    const payload = {
      content: message, // Discord
      text: message, // Slack
      message, // ntfy / generic
      title: hits.length === 1 ? "Cinema seat available" : `${hits.length} cinema seats available`,
      hits,
    };
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Explicit UA: some webhook hosts (Discord) 403 the default urllib/runtime UA.
        "User-Agent": "auscinema-watcher/0.0.0",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`webhook POST failed: ${res.status} ${res.statusText}`);
    }
  }
}

/** Fallback notifier - prints to stdout when no webhook is configured. */
export class ConsoleNotifier implements Notifier {
  constructor(private readonly log: (msg: string) => void = (m) => console.log(m)) {}
  async notify(hits: Hit[]): Promise<void> {
    if (hits.length === 0) return;
    this.log(formatMessage(hits));
  }
}
