import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCatalogTitles, fetchOptions } from "./api";

function jsonResponse(status: number, body: unknown, statusText = ""): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
  } as Response;
}

/** Extracts a fetch mock call's Nth argument, asserting it was actually recorded. Test-only guard
 *  for noUncheckedIndexedAccess — a missing call/arg is a real test bug, so throw loudly rather
 *  than silently proceeding with `undefined`. */
function requireMockCallArg<T>(calls: (T | undefined)[][], callIndex: number, argIndex: number): T {
  const call = calls[callIndex];
  if (!call) throw new Error(`expected mock call at index ${callIndex}, but only ${calls.length} were recorded`);
  const arg = call[argIndex];
  if (arg === undefined) throw new Error(`expected arg ${argIndex} on mock call ${callIndex} to be defined`);
  return arg;
}

describe("movies/api", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("URL/param construction", () => {
    it("fetchOptions builds /options with movieKey, party, and minScore", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        jsonResponse(200, {
          movieKey: "event:555",
          movieTitle: "Dune: Part Two",
          party: 3,
          minScore: 74,
          count: 0,
          options: [],
          freshness: {
            oldestFetchedAt: "",
            newestFetchedAt: "",
            lastSuccessfulIngestAt: "",
            coverage: {},
          },
        }),
      );

      await fetchOptions({ movieKey: "event:555", party: 3, minScore: 74 });

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const url = new URL(
        String(requireMockCallArg(vi.mocked(global.fetch).mock.calls, 0, 0)),
        "http://test",
      );
      expect(url.pathname).toBe("/options");
      expect(url.searchParams.get("movieKey")).toBe("event:555");
      expect(url.searchParams.get("party")).toBe("3");
      expect(url.searchParams.get("minScore")).toBe("74");
    });

    it("fetchOptions omits party/minScore from the query when not provided", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        jsonResponse(200, {
          movieKey: "event:555",
          movieTitle: "Dune: Part Two",
          party: 2,
          minScore: 74,
          count: 0,
          options: [],
          freshness: {
            oldestFetchedAt: "",
            newestFetchedAt: "",
            lastSuccessfulIngestAt: "",
            coverage: {},
          },
        }),
      );

      await fetchOptions({ movieKey: "event:555" });

      const url = new URL(
        String(requireMockCallArg(vi.mocked(global.fetch).mock.calls, 0, 0)),
        "http://test",
      );
      expect(url.searchParams.has("party")).toBe(false);
      expect(url.searchParams.has("minScore")).toBe(false);
    });

    it("fetchCatalogTitles builds /catalog with the chain query param", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        jsonResponse(200, {
          movies: [],
          cinemas: [],
          dates: [],
          titles: [{ movieKey: "hoyts:900", chain: "hoyts", title: "The Odyssey", sessionCount: 6 }],
        }),
      );

      await fetchCatalogTitles("hoyts");

      const url = new URL(
        String(requireMockCallArg(vi.mocked(global.fetch).mock.calls, 0, 0)),
        "http://test",
      );
      expect(url.pathname).toBe("/catalog");
      expect(url.searchParams.get("chain")).toBe("hoyts");
    });
  });

  describe("error-status parsing", () => {
    // import.meta.env.DEV is statically inlined `true` under vitest (same as a real dev build), so
    // fetchOptions' dev-mode fallback always swallows the thrown error into a fixture — there is no
    // runtime way to flip DEV off for this build. The parsed error is still produced (getJson throws
    // it internally) and logged via console.warn before the fallback kicks in, so assert the parsed
    // message there instead of via a rejection.
    it("429 with a JSON {error} body is parsed into the error message", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        jsonResponse(429, { error: "rate limited" }, "Too Many Requests"),
      );
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await fetchOptions({ movieKey: "event:555" });

      expect(warn).toHaveBeenCalledTimes(1);
      const loggedError = requireMockCallArg(warn.mock.calls, 0, 1) as Error;
      expect(loggedError.message).toBe("429: rate limited");
    });

    it("503 with a non-JSON body is parsed via the statusText fallback", async () => {
      const res = {
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        json: async () => {
          throw new Error("not json");
        },
      } as unknown as Response;
      vi.mocked(global.fetch).mockResolvedValueOnce(res);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await fetchOptions({ movieKey: "event:555" });

      expect(warn).toHaveBeenCalledTimes(1);
      const loggedError = requireMockCallArg(warn.mock.calls, 0, 1) as Error;
      expect(loggedError.message).toBe("503: Service Unavailable");
    });
  });

  describe("fixtureFor chain-matching (dev-mode fallback)", () => {
    it("a hoyts movieKey falls back to hoyts-only options, never mixing in other chains", async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce(new Error("network down"));

      const res = await fetchOptions({ movieKey: "hoyts:555", party: 3, minScore: 74 });

      expect(res.movieKey).toBe("hoyts:555");
      expect(res.options).toHaveLength(1);
      expect(res.options.every((o) => o.chain === "hoyts")).toBe(true);
      expect(res.count).toBe(res.options.length);
    });

    it("an event movieKey falls back to event-only options", async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce(new Error("network down"));

      const res = await fetchOptions({ movieKey: "event:555" });

      expect(res.options).toHaveLength(1);
      expect(res.options.every((o) => o.chain === "event")).toBe(true);
    });

    it("a village movieKey falls back to village-only options", async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce(new Error("network down"));

      const res = await fetchOptions({ movieKey: "village:555" });

      expect(res.options).toHaveLength(1);
      expect(res.options.every((o) => o.chain === "village")).toBe(true);
    });
  });
});
