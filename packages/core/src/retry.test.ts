import { test } from "node:test";
import assert from "node:assert/strict";
import { UpstreamError } from "./errors.ts";
import { createUpstreamRetry, isRetryableUpstream } from "./retry.ts";

const http = (status: number): UpstreamError => new UpstreamError(`http ${status}`, { kind: "http", status });

/** A retry wrapper with a recording, non-waiting sleep. */
function harness(random = 0.5) {
  const sleeps: number[] = [];
  const clock = { now: 1_000_000 };
  const retry = createUpstreamRetry({
    now: () => clock.now,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => random,
  });
  return { retry, sleeps, clock };
}

/** An attempt that throws the queued errors in order, then resolves "ok". */
function failing(errors: unknown[]) {
  const state = { calls: 0 };
  const attempt = async (): Promise<string> => {
    const err = errors[state.calls];
    state.calls++;
    if (err !== undefined) throw err;
    return "ok";
  };
  return { attempt, state };
}

test("isRetryableUpstream: 429/502/503, timeouts and raw network errors only", () => {
  for (const status of [429, 502, 503]) assert.equal(isRetryableUpstream(http(status)), true, String(status));
  for (const status of [400, 404, 410, 500, 504]) assert.equal(isRetryableUpstream(http(status)), false, String(status));
  assert.equal(isRetryableUpstream(new UpstreamError("t", { kind: "timeout" })), true);
  assert.equal(isRetryableUpstream(new TypeError("socket closed")), true);
  assert.equal(isRetryableUpstream(new UpstreamError("p", { kind: "parse" })), false);
  assert.equal(isRetryableUpstream(new UpstreamError("a", { kind: "auth", status: 401 })), false);
  assert.equal(isRetryableUpstream(new UpstreamError("a", { kind: "auth", status: 503 })), false);
});

test("a 429 that clears is retried after one jittered sleep and succeeds", async () => {
  const { retry, sleeps } = harness();
  const { attempt, state } = failing([http(429)]);
  assert.equal(await retry(attempt), "ok");
  assert.equal(state.calls, 2);
  assert.deepEqual(sleeps, [187.5]);
});

test("a persistent 503 stops at three attempts and rethrows the upstream error", async () => {
  const { retry, sleeps } = harness();
  const { attempt, state } = failing([http(503), http(503), http(503), http(503)]);
  await assert.rejects(retry(attempt), (err: unknown) => err instanceof UpstreamError && err.status === 503);
  assert.equal(state.calls, 3);
  assert.deepEqual(sleeps, [187.5, 375]);
});

test("jitter spans half to the full exponential step", async () => {
  for (const [random, expected] of [
    [0, [125, 250]],
    [1, [250, 500]],
  ] as const) {
    const { retry, sleeps } = harness(random);
    await assert.rejects(retry(failing([http(502), http(502), http(502)]).attempt));
    assert.deepEqual(sleeps, expected);
  }
});

test("non-retryable failures fail fast: one attempt, no sleep", async () => {
  for (const err of [http(400), http(404), http(500), new UpstreamError("p", { kind: "parse" })]) {
    const { retry, sleeps } = harness();
    const { attempt, state } = failing([err, err, err]);
    await assert.rejects(retry(attempt), (thrown: unknown) => thrown === err);
    assert.equal(state.calls, 1);
    assert.deepEqual(sleeps, []);
  }
});

test("timeouts and raw network errors get one retry", async () => {
  for (const err of [new UpstreamError("t", { kind: "timeout" }), new TypeError("socket closed")]) {
    const { retry } = harness();
    const { attempt, state } = failing([err, err, err]);
    await assert.rejects(retry(attempt), (thrown: unknown) => thrown === err);
    assert.equal(state.calls, 2);
  }
});

test("retries are suspended after three exhausted calls and resume after a success", async () => {
  const { retry, sleeps } = harness();
  const down = () => failing([http(429), http(429), http(429), http(429)]);

  for (let i = 0; i < 3; i++) {
    const call = down();
    await assert.rejects(retry(call.attempt));
    assert.equal(call.state.calls, 3, `call ${i + 1} uses its full retry budget`);
  }
  sleeps.length = 0;
  for (let i = 0; i < 4; i++) {
    const call = down();
    await assert.rejects(retry(call.attempt));
    assert.equal(call.state.calls, 1, "a suspended upstream gets a single attempt");
  }
  assert.deepEqual(sleeps, []);

  assert.equal(await retry(failing([]).attempt), "ok");
  const recovered = failing([http(429)]);
  assert.equal(await retry(recovered.attempt), "ok");
  assert.equal(recovered.state.calls, 2, "a success re-arms retries");
});

test("a suspension expires after 60s so a long-lived process gets its retries back", async () => {
  const { retry, clock } = harness();
  const down = () => failing([http(503), http(503), http(503), http(503)]);
  for (let i = 0; i < 3; i++) await assert.rejects(retry(down().attempt));

  clock.now += 59_999;
  const suspended = down();
  await assert.rejects(retry(suspended.attempt));
  assert.equal(suspended.state.calls, 1, "failures while suspended do not extend the window");

  clock.now += 1;
  const rearmed = failing([http(503)]);
  assert.equal(await retry(rearmed.attempt), "ok", "a brief 503 after the window recovers on retry");
  assert.equal(rearmed.state.calls, 2);
});

test("a non-retryable failure neither counts toward nor clears suspension", async () => {
  const { retry } = harness();
  for (let i = 0; i < 2; i++) await assert.rejects(retry(failing([http(503), http(503), http(503)]).attempt));
  await assert.rejects(retry(failing([http(404)]).attempt));
  const third = failing([http(503), http(503), http(503)]);
  await assert.rejects(retry(third.attempt));
  assert.equal(third.state.calls, 3);
  const fourth = failing([http(503), http(503), http(503)]);
  await assert.rejects(retry(fourth.attempt));
  assert.equal(fourth.state.calls, 1);
});
