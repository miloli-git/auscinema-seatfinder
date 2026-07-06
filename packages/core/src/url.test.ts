import { test } from "node:test";
import assert from "node:assert/strict";
import { safePosterUrl } from "./url.ts";

test("https URL passes through unchanged", () => {
  assert.equal(
    safePosterUrl("https://imgix.hoyts.com.au/mx/posters/au/moana-2026-f3e28c64.jpg"),
    "https://imgix.hoyts.com.au/mx/posters/au/moana-2026-f3e28c64.jpg",
  );
});

test("http URL is rejected (https-only)", () => {
  assert.equal(safePosterUrl("http://example.com/poster.jpg"), undefined);
});

test("javascript: URL is rejected", () => {
  assert.equal(safePosterUrl("javascript:alert(1)"), undefined);
});

test("data: URL is rejected", () => {
  assert.equal(safePosterUrl("data:image/png;base64,AAAA"), undefined);
});

test("relative path is rejected (no origin to resolve against)", () => {
  assert.equal(safePosterUrl("mx/posters/au/moana-2026-f3e28c64.jpg"), undefined);
  assert.equal(safePosterUrl("/mx/posters/au/moana-2026-f3e28c64.jpg"), undefined);
});

test("garbage / non-URL strings are rejected", () => {
  assert.equal(safePosterUrl("not a url"), undefined);
  assert.equal(safePosterUrl(""), undefined);
});

test("non-string values are rejected", () => {
  assert.equal(safePosterUrl(undefined), undefined);
  assert.equal(safePosterUrl(null), undefined);
  assert.equal(safePosterUrl(123), undefined);
  assert.equal(safePosterUrl({}), undefined);
});
