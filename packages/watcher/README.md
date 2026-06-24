# @auscinema/watcher

Optional alert worker. Polls a JSON-configured set of saved queries on an interval, scores the best
available seat per session via `@auscinema/core`, and fires a webhook when a session crosses your
score threshold. Independent of the Seats Together pipeline — this is the live-alert path.

## CLI (`auscinema-watch`)

Config path resolves `argv[3]` → `$WATCHER_CONFIG` → `./watch.config.json`.
Webhook resolves `$WATCHER_WEBHOOK` → `config.notifier.webhookUrl` → console.

```bash
npm run check -w @auscinema/watcher   # single-shot (the NAS-cron entrypoint)
npm run watch -w @auscinema/watcher   # loop on pollIntervalMs (default 5 min), backing off on errors
```

(Underlying commands: `node dist/cli.js check|watch [configPath]`. `start` aliases `watch`.)

## Public API (barrel `src/index.ts`)

Re-exports `config`, `registry`, `state`, `notifier`, `check`:

- `loadConfig(path)`, `validateConfig(raw)`, types `WatcherConfig`, `Watch`, `TimeWindow`,
  `NotifierConfig` (`config.ts`).
- `defaultRegistry()` / `resolveAdapter(registry, chain)` (`registry.ts`) — chain → adapter map.
- `WatchState`, `loadState(path)`, `saveState(path, state)` (`state.ts`) — local JSON state of what
  has already been alerted (so you aren't re-pinged for the same seat).
- `runCheck(config, deps) → CheckResult`, `inTimeWindow(startTime, window?)`, types `CheckDeps`,
  `CheckError`, `CheckResult` (`check.ts`) — one poll cycle: for each watch, list sessions, score,
  collect hits above threshold.
- `WebhookNotifier`, `ConsoleNotifier` (impl `Notifier`), `formatHit`, `formatMessage`, types `Hit`,
  `FetchLike` (`notifier.ts`).

## Behaviour
- Per watch: list sessions (optionally filtered to a time window via `inTimeWindow`), score the best
  seat per session, and emit a `Hit` when it crosses the configured score threshold.
- State persists between runs so a seat is alerted once, not every cycle. Errors back off rather
  than abort.
- For a hosted multi-user service the one thing to replace is the local JSON state file (swap for a
  database) — noted in `deploy/README.md`.

## Develop
```bash
npm run build -w @auscinema/watcher
npm test      -w @auscinema/watcher   # tsc -b + node --test (check.test.ts)
```
