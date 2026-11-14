import { UpstreamError } from "./errors.ts";

/** Upstream HTTP statuses that mean "try again shortly": throttled or briefly unavailable. */
const RETRYABLE_HTTP_STATUSES: ReadonlySet<number> = new Set([429, 502, 503]);

/**
 * True for a failure worth retrying: a timeout, a raw network error (anything not yet normalised
 * to an UpstreamError), or HTTP 429/502/503. Every other status, auth and parse failures fail fast.
 */
export function isRetryableUpstream(err: unknown): boolean {
  if (!(err instanceof UpstreamError)) return true;
  if (err.kind === "timeout") return true;
  return err.kind === "http" && err.status !== undefined && RETRYABLE_HTTP_STATUSES.has(err.status);
}

export interface UpstreamRetryOptions {
  /** Total attempts for a retryable HTTP status. Default 3. */
  maxHttpAttempts?: number;
  /** Total attempts for a timeout or network error (each timeout already cost 15s). Default 2. */
  maxNetworkAttempts?: number;
  /** Base of the jittered exponential delay before a retry. Default 250ms. */
  baseDelayMs?: number;
  /** Consecutive retry-exhausted calls after which retries are suspended. Default 3. */
  suspendAfter?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export type UpstreamRetry = <T>(attempt: () => Promise<T>) => Promise<T>;

/**
 * Build a retry wrapper for one upstream (one per adapter instance). Retryable failures are
 * retried after a jittered sleep, up to the attempt cap; the last error is rethrown as-is.
 *
 * Once `suspendAfter` consecutive calls have exhausted their retries the upstream is treated as
 * down or throttling, and later calls make a single attempt until one succeeds. That keeps a
 * failing chain's request volume flat while the refresh tick's C5 backoff and cool-down take over.
 */
export function createUpstreamRetry(opts: UpstreamRetryOptions = {}): UpstreamRetry {
  const maxHttpAttempts = opts.maxHttpAttempts ?? 3;
  const maxNetworkAttempts = opts.maxNetworkAttempts ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 250;
  const suspendAfter = opts.suspendAfter ?? 3;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;
  let consecutiveExhausted = 0;

  return async <T>(attempt: () => Promise<T>): Promise<T> => {
    for (let attempts = 1; ; attempts++) {
      try {
        const result = await attempt();
        consecutiveExhausted = 0;
        return result;
      } catch (err) {
        if (!isRetryableUpstream(err)) throw err;
        const isHttp = err instanceof UpstreamError && err.kind === "http";
        const cap = consecutiveExhausted >= suspendAfter ? 1 : isHttp ? maxHttpAttempts : maxNetworkAttempts;
        if (attempts >= cap) {
          consecutiveExhausted++;
          throw err;
        }
        // Half to full of the exponential step, so concurrent retries do not land together.
        await sleep(baseDelayMs * 2 ** (attempts - 1) * (0.5 + random() / 2));
      }
    }
  };
}
