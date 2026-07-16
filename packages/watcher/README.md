# @auscinema/watcher

Optional alert worker with two modes:

- `seat-available` (the default): score available seats and alert when one crosses the threshold.
- `new-session`: poll lightweight session listings and alert when a never-before-seen session id is
  added after the watch has established its baseline. Set `requirePurchasable: true` to wait until
  the listing reports seats for sale and exposes a secure booking link.

It is independent of the Seats Together pipeline — this is the live-alert path.

## CLI (`auscinema-watch`)

Config path resolves `argv[3]` → `$WATCHER_CONFIG` → `./watch.config.json`.
Webhook resolves `$WATCHER_WEBHOOK` → `config.notifier.webhookUrl` → console. Keep real Discord
webhook URLs in the environment, not in tracked config.

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
  has already been alerted or observed.
- `runCheck(config, deps) → CheckResult`, `inTimeWindow(startTime, window?)`, types `CheckDeps`,
  `CheckError`, `CheckResult` (`check.ts`) — one poll cycle: for each watch, list sessions, score,
  collect hits above threshold.
- `WebhookNotifier`, `ConsoleNotifier` (impl `Notifier`), seat/session formatters, types `Hit`,
  `SessionAlert`, `FetchLike` (`notifier.ts`).

## Behaviour
- Seat watches list sessions (optionally filtered to a time window), score seats, and emit a `Hit`
  above the configured threshold.
- New-session watches only call `listSessions`; they never fetch seat maps. Each business date is
  silently baselined the first time it enters scope, including dates entering a rolling horizon.
  Later unseen session ids on that date are alerted once. This avoids startup floods and false
  alerts from the horizon moving forward.
- With `requirePurchasable: true`, a session is eligible only when `seatsAvailable > 0` and
  `bookingUrl` is a valid HTTPS URL. An unseen session that appears before sales open remains
  unrecorded, so it alerts once when those fields later show that purchasing is available.
- State persists between runs. Errors back off rather than abort.
- For a hosted multi-user service the one thing to replace is the local JSON state file (swap for a
  database) — noted in `deploy/README.md`.

## Odyssey at IMAX Sydney

The ready-to-copy [`watch.odyssey-imax-sydney.json.example`](watch.odyssey-imax-sydney.json.example)
uses the repo's live-verified Event identifiers (`movieId` `19797`, cinema `96`) and a 21-day-ahead rolling
window. Run the first check to establish a silent baseline; subsequent checks send newly added
purchase-ready sessions to `WATCHER_WEBHOOK`.

Acceptance contract for that config:

1. Given the watch has completed a successful baseline for a date,
2. when Event returns a previously unseen session id for movie `19797` at cinema `96`,
3. and that listing has `seatsAvailable > 0` plus an HTTPS booking URL,
4. then the watcher sends one Discord alert containing the showtime, format, available-seat count,
   and booking link, and does not alert for that session id again.

## Develop
```bash
npm run build -w @auscinema/watcher
npm test      -w @auscinema/watcher   # tsc -b + node --test (check.test.ts)
```
