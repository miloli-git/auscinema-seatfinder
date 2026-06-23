/**
 * API service — STUB.
 *
 * Thin Fastify service that fronts the chain adapters and the scorer:
 *   GET /cinemas?chain=event
 *   GET /sessions?chain=event&movieId=..&cinemaIds=..&date=YYYY-MM-DD
 *   GET /seatmap?chain=event&sessionId=..            (scored against optional prefs)
 *   GET /best?chain=event&movieId=..&cinemaIds=..&date=..&prefs=..  (ranked sessions + best seats)
 *
 * Caches session listings (minutes); fetches seat maps live on demand. Uses the adapter
 * `preview` flag for any background polling.
 *
 * TODO(api): implement. Wire adapters by chain, add core.scoreSeat, add an in-memory cache.
 */
export {};
