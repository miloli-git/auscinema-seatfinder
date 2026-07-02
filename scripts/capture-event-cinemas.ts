/**
 * Capture the Event Cinemas AU cinema list from the /Cinemas page HTML (#51).
 *
 * Event's /api/cinemas/JsonLd feed is dead (empty @graph); the live list exists only in the
 * page markup as `<a class="eccheckbox" data-id data-name data-url data-lat data-long
 * id="cinema-select_{id}_checkbox">` tags. This script fetches the page, parses those tags,
 * and emits the same snapshot shape the adapter bundles at
 * packages/adapters/event/data/cinemas.au.json.
 *
 * Usage:
 *   tsx scripts/capture-event-cinemas.ts                        # overwrite the bundled snapshot
 *   tsx scripts/capture-event-cinemas.ts --out /path/snap.json  # write elsewhere
 *   tsx scripts/capture-event-cinemas.ts --stdout               # print, write nothing
 *   tsx scripts/capture-event-cinemas.ts --compare <path>       # diff vs an existing snapshot:
 *                                                               #   exit 0 = same, 3 = drift
 * Exit codes: 0 ok/no drift, 2 capture failed guardrail (fetch error, parse < MIN_CINEMAS,
 * missing fields), 3 drift detected (--compare only).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const MIN_CINEMAS = 45;
const SOURCE_URL = "https://www.eventcinemas.com.au/Cinemas";
const DEFAULT_OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../packages/adapters/event/data/cinemas.au.json",
);

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
};

interface CinemaEntry {
  id: string;
  name: string;
  url?: string;
  lat?: number;
  long?: number;
}

interface Snapshot {
  source: string;
  capturedAt: string;
  region: string;
  count: number;
  note: string;
  cinemas: CinemaEntry[];
}

function fail(msg: string): never {
  console.error(`capture-event-cinemas: ${msg}`);
  process.exit(2);
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : undefined;
}

export function parseCinemas(html: string): CinemaEntry[] {
  const tags = html.match(/<a\s[^>]*id="cinema-select_\d+_checkbox"[^>]*>/g) ?? [];
  const byId = new Map<string, CinemaEntry>();
  for (const tag of tags) {
    const id = attr(tag, "data-id") ?? attr(tag, "id")?.match(/cinema-select_(\d+)_/)?.[1];
    const name = attr(tag, "data-name");
    if (!id || !name) continue;
    if (byId.has(id)) continue;
    const url = attr(tag, "data-url");
    const lat = Number.parseFloat(attr(tag, "data-lat") ?? "");
    const long = Number.parseFloat(attr(tag, "data-long") ?? "");
    byId.set(id, {
      id,
      name,
      ...(url ? { url } : {}),
      ...(Number.isFinite(lat) ? { lat } : {}),
      ...(Number.isFinite(long) ? { long } : {}),
    });
  }
  return [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));
}

function sydneyDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());
}

function buildSnapshot(cinemas: CinemaEntry[]): Snapshot {
  return {
    source: `${SOURCE_URL} (HTML; the /api/cinemas/JsonLd feed is dead/empty)`,
    capturedAt: sydneyDate(),
    region: "AU",
    count: cinemas.length,
    note:
      "Dated snapshot. Event's /api/cinemas/JsonLd returns an empty @graph; the live list exists " +
      "only in the /Cinemas page HTML. Refresh with scripts/capture-event-cinemas.ts. ids are the " +
      "numeric cinemaIds used by GetSessions.",
    cinemas,
  };
}

/** Diff two snapshots by cinema id; returns human lines, empty = no drift. */
export function diffSnapshots(current: Snapshot, fresh: Snapshot): string[] {
  const lines: string[] = [];
  const cur = new Map(current.cinemas.map((c) => [c.id, c]));
  const nxt = new Map(fresh.cinemas.map((c) => [c.id, c]));
  for (const [id, c] of nxt) if (!cur.has(id)) lines.push(`+ added ${id} "${c.name}"`);
  for (const [id, c] of cur) if (!nxt.has(id)) lines.push(`- removed ${id} "${c.name}"`);
  for (const [id, c] of nxt) {
    const prev = cur.get(id);
    if (!prev) continue;
    if (prev.name !== c.name || prev.url !== c.url)
      lines.push(`~ changed ${id} "${prev.name}" -> "${c.name}" (${prev.url} -> ${c.url})`);
  }
  return lines;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const res = await fetch(SOURCE_URL, { headers: BROWSER_HEADERS }).catch((err) =>
    fail(`fetch failed: ${err}`),
  );
  if (!res.ok) fail(`fetch failed: ${res.status} ${res.statusText}`);
  const html = await res.text();

  const cinemas = parseCinemas(html);
  if (cinemas.length < MIN_CINEMAS)
    fail(
      `guardrail: parsed ${cinemas.length} cinemas (< ${MIN_CINEMAS}) - page format likely changed, refusing to write`,
    );
  const snapshot = buildSnapshot(cinemas);

  const comparePath = flag("--compare");
  if (comparePath) {
    const current = JSON.parse(readFileSync(comparePath, "utf8")) as Snapshot;
    const drift = diffSnapshots(current, snapshot);
    if (drift.length === 0) {
      console.log(`no drift (${cinemas.length} cinemas, current capturedAt ${current.capturedAt})`);
      return;
    }
    console.log(`DRIFT vs ${comparePath} (capturedAt ${current.capturedAt}):`);
    for (const line of drift) console.log(`  ${line}`);
    process.exit(3);
  }

  const json = JSON.stringify(snapshot, null, 2) + "\n";
  if (argv.includes("--stdout")) {
    process.stdout.write(json);
    return;
  }
  const out = flag("--out") ?? DEFAULT_OUT;
  writeFileSync(out, json);
  console.log(`wrote ${cinemas.length} cinemas -> ${out} (capturedAt ${snapshot.capturedAt})`);
}

main().catch((err) => {
  console.error(`capture-event-cinemas crashed: ${(err as Error).stack ?? err}`);
  process.exitCode = 1;
});
