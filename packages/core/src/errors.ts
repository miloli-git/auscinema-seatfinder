/**
 * Typed upstream-failure error shared by every chain adapter. Adapters wrap a chain's HTTP
 * failure (non-2xx, timeout, bad JSON, auth bootstrap) into one of these so the API service can
 * map it to a meaningful status (502 upstream / 503 timeout) instead of a blanket 500.
 */
export type UpstreamErrorKind = "timeout" | "http" | "parse" | "auth" | "unknown";

export class UpstreamError extends Error {
  /** What kind of upstream failure this is, used by the API to pick a status code. */
  readonly kind: UpstreamErrorKind;
  /** Upstream HTTP status, when `kind === "http"`. */
  readonly status?: number;

  constructor(message: string, opts: { kind: UpstreamErrorKind; status?: number; cause?: unknown }) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "UpstreamError";
    this.kind = opts.kind;
    if (opts.status !== undefined) this.status = opts.status;
  }
}

/** True for an AbortController-triggered fetch abort (request timeout). */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}
