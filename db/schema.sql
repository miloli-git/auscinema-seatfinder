-- Seats Together — Postgres schema (cached adjacency discovery)
-- Source of truth: design/seats-together-design.md §Schema.
-- Re-appliable: every object uses IF NOT EXISTS so this can be re-run via psql
-- and is also safe as a first-boot init script (/docker-entrypoint-initdb.d).
--
-- session_seats stores AVAILABLE + scored seats ONLY. A missing seat = a column
-- gap = an adjacency break, so sold/aisle/spacer seats are intentionally not
-- stored. Do not add rows for unavailable seats.

-- watches: the swept watchlist, seeded from watches.json, addable later.
CREATE TABLE IF NOT EXISTS watches (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain       TEXT        NOT NULL,
  cinema_ids  TEXT[]      NOT NULL,
  date_from   DATE        NOT NULL,
  date_to     DATE        NOT NULL,
  movie_id    TEXT,                       -- null = all movies for the chain/cinemas
  party       INTEGER     NOT NULL DEFAULT 2,
  min_score   INTEGER     NOT NULL DEFAULT 74,
  scoring     JSONB,                      -- SeatPreference used by the ingester scorer
  enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- sessions: one row per discovered showtime. id is the chain-provided session id.
CREATE TABLE IF NOT EXISTS sessions (
  id               TEXT        PRIMARY KEY,
  watch_id         BIGINT      REFERENCES watches(id) ON DELETE SET NULL,
  chain            TEXT        NOT NULL,
  movie_id         TEXT        NOT NULL,
  movie_name       TEXT,
  cinema_id        TEXT        NOT NULL,
  cinema_name      TEXT,
  date             DATE        NOT NULL,
  start_time       TIMESTAMPTZ,
  format           TEXT,
  screen           TEXT,
  seats_available  INTEGER,
  booking_url      TEXT,
  seat_allocation  BOOLEAN,
  fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- session_seats: AVAILABLE + scored seats only (the compact "blocks" material
-- that keeps party N / minScore Q tunable at query time). FK CASCADE so the
-- ingester's per-session delete+insert in a txn cleans up its own rows.
CREATE TABLE IF NOT EXISTS session_seats (
  session_id  TEXT     NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seat_id     TEXT     NOT NULL,
  row_label   TEXT,
  row         INTEGER  NOT NULL,
  col         INTEGER  NOT NULL,
  area_kind   TEXT,
  score       INTEGER  NOT NULL,
  PRIMARY KEY (session_id, seat_id)
);

-- ingest_runs: one row per sweep, for verification + dead-man alerting.
CREATE TABLE IF NOT EXISTS ingest_runs (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ,
  watches           INTEGER,
  sessions_upserted INTEGER,
  seatmaps_fetched  INTEGER,
  errors            INTEGER
);

-- Indexes for the /together query: filter sessions by chain/movie/cinema/date,
-- then join session_seats by session_id (ordered for adjacency scans) and rank.
-- Composite covers the full filter (chain, movie_id, cinema-IN, date-range); the
-- shorter index serves the all-cinemas filter path where cinema_id is unbound.
CREATE INDEX IF NOT EXISTS idx_sessions_chain_movie_cinema_date ON sessions (chain, movie_id, cinema_id, date);
CREATE INDEX IF NOT EXISTS idx_sessions_chain_movie_date        ON sessions (chain, movie_id, date);
-- (session_id) join is already served by the PK prefix (session_id, seat_id);
-- this index instead orders seats by (row, col) within a session for the
-- per-row adjacency walk in findAdjacentBlocks.
CREATE INDEX IF NOT EXISTS idx_session_seats_session_rowcol     ON session_seats (session_id, row, col);
