import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type Chain,
  type ChainAdapter,
  type Cinema,
  type ScoredSeat,
  type Seat,
  type SeatBlock,
  type SeatMap,
  type Session,
  type SessionQuery,
} from "@auscinema/core";
import { buildServer } from "./index.js";

interface FakeAdapterOpts {
  chain?: Chain;
  getSeatMap?: (sessionId: string) => Promise<SeatMap>;
}

type SeatMapResponse = SeatMap & {
  scored: ScoredSeat[];
  block?: SeatBlock | null;
  blocks?: SeatBlock[];
  party?: number;
  minScore?: number;
};

function fakeAdapter(opts: FakeAdapterOpts = {}): ChainAdapter {
  const chain = opts.chain ?? "event";
  return {
    chain,
    async listCinemas(): Promise<Cinema[]> {
      return [];
    },
    async listSessions(_q: SessionQuery): Promise<Session[]> {
      return [];
    },
    async getSeatMap(sessionId: string): Promise<SeatMap> {
      if (opts.getSeatMap) return opts.getSeatMap(sessionId);
      return designedSeatMap(sessionId, chain);
    },
  };
}

function makeSeat(id: string, rowLabel: string, row: number, col: number, status: Seat["status"]): Seat {
  return {
    id,
    name: id,
    rowLabel,
    row,
    col,
    status,
    areaId: "standard",
  };
}

function seatMap(sessionId: string, chain: Chain, seats: Seat[]): SeatMap {
  return {
    chain,
    sessionId,
    areas: [{ id: "standard", name: "Standard", kind: "standard" }],
    seats,
  };
}

function designedSeatMap(sessionId: string, chain: Chain): SeatMap {
  if (sessionId === "split") {
    return seatMap(sessionId, chain, [
      makeSeat("A1", "A", 0, 1, "available"),
      makeSeat("A2", "A", 0, 2, "available"),
      makeSeat("A3", "A", 0, 3, "sold"),
      makeSeat("A4", "A", 0, 4, "available"),
      makeSeat("A5", "A", 0, 5, "available"),
    ]);
  }

  if (sessionId === "soldout") {
    return seatMap(sessionId, chain, [
      makeSeat("S1", "S", 0, 1, "sold"),
      makeSeat("S2", "S", 0, 2, "sold"),
      makeSeat("S3", "S", 0, 3, "sold"),
    ]);
  }

  return seatMap(sessionId, chain, [
    makeSeat("L1", "L", 0, 1, "available"),
    makeSeat("L2", "L", 0, 2, "available"),
    makeSeat("L3", "L", 0, 3, "available"),
    makeSeat("L4", "L", 0, 4, "available"),
    makeSeat("L5", "L", 0, 5, "available"),
  ]);
}

function server() {
  return buildServer({ adapters: { event: fakeAdapter() }, rateLimit: false, logger: false });
}

async function getSeatMap(query: string): Promise<SeatMapResponse> {
  const res = await server().inject({ method: "GET", url: `/seatmap?${query}` });
  assert.equal(res.statusCode, 200);
  return res.json() as SeatMapResponse;
}

function assertNoLiveBlockKeys(body: SeatMapResponse): void {
  assert.deepEqual(Object.keys(body).sort(), ["areas", "chain", "scored", "seats", "sessionId"]);
  assert.equal("block" in body, false);
  assert.equal("blocks" in body, false);
  assert.equal("party" in body, false);
  assert.equal("minScore" in body, false);
}

test("GET /seatmap without party keeps the existing response shape exactly", async () => {
  const body = await getSeatMap("chain=event&sessionId=happy");

  assertNoLiveBlockKeys(body);
  assert.equal(body.sessionId, "happy");
  assert.ok(body.scored.length > 0, "expected scored seats to remain present");
});

test("GET /seatmap with party returns the best live adjacent block and all live blocks", async () => {
  const body = await getSeatMap("chain=event&sessionId=happy&party=2&minScore=74");

  assert.equal(body.party, 2);
  assert.equal(body.minScore, 74);
  assert.ok(body.block, "expected a live block");
  assert.ok(body.blocks, "expected live blocks");
  assert.equal(body.block.seatIds.length, 2);
  assert.deepEqual(body.blocks[0], body.block);

  const scoredById = new Map(body.scored.map((s) => [s.seat.id, s]));
  for (const id of body.block.seatIds) {
    const scored = scoredById.get(id);
    assert.ok(scored, `expected ${id} to be present in scored`);
    assert.equal(scored.seat.status, "available");
  }
});

test("GET /seatmap does not bridge a sold-seat gap when recomputing blocks", async () => {
  const body = await getSeatMap("chain=event&sessionId=split&party=2&minScore=74");

  assert.equal(body.party, 2);
  assert.equal(body.minScore, 74);
  assert.equal(body.block, null);
  assert.deepEqual(body.blocks, []);
  assert.ok(body.scored.some((s) => s.seat.id === "A2"), "left side of gap should be scored");
  assert.ok(body.scored.some((s) => s.seat.id === "A4"), "right side of gap should be scored");
  assert.equal(body.scored.some((s) => s.seat.id === "A3"), false, "sold gap seat must not be scored");
});

test("GET /seatmap returns null block and empty blocks when no qualifying run exists", async () => {
  const tooLarge = await getSeatMap("chain=event&sessionId=happy&party=6&minScore=74");
  assert.equal(tooLarge.block, null);
  assert.deepEqual(tooLarge.blocks, []);

  const soldout = await getSeatMap("chain=event&sessionId=soldout&party=2&minScore=74");
  assert.deepEqual(soldout.scored, []);
  assert.equal(soldout.block, null);
  assert.deepEqual(soldout.blocks, []);
});

test("GET /seatmap defaults minScore only when party is present; minScore alone does not trigger blocks", async () => {
  const defaulted = await getSeatMap("chain=event&sessionId=happy&party=2");
  assert.equal(defaulted.party, 2);
  assert.equal(defaulted.minScore, 74);
  assert.ok(defaulted.block, "party without minScore should still compute a defaulted live block");

  const minScoreOnly = await getSeatMap("chain=event&sessionId=happy&minScore=74");
  assertNoLiveBlockKeys(minScoreOnly);
});
