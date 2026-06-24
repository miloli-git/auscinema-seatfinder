/**
 * node-postgres pool factory for the DB-backed endpoints (/together, /catalog).
 * DATABASE_URL from the argument or the environment. /seatmap and the other live endpoints do not
 * use this — they call the chain adapters directly.
 *
 * Handlers use `pool.query(...)` only (auto checkout + release), so there is no connection-leak path.
 */
import pg from "pg";

const { Pool } = pg;
export type { Pool } from "pg";

/** Create a connection pool, or return undefined when no connection string is configured. */
export function createPoolFromEnv(databaseUrl?: string): pg.Pool | undefined {
  const connectionString = databaseUrl ?? process.env.DATABASE_URL;
  if (!connectionString || connectionString.trim() === "") return undefined;
  return new Pool({ connectionString });
}
