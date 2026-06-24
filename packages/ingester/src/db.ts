/**
 * node-postgres pool factory. DATABASE_URL from the argument or the environment.
 * The pool is shared across a sweep; per-session transactions check out a client and
 * always release it (see persist.ts).
 */
import pg from "pg";

const { Pool } = pg;
export type { Pool } from "pg";

/** Create a connection pool. Throws clearly when no connection string is available. */
export function createPool(databaseUrl?: string): pg.Pool {
  const connectionString = databaseUrl ?? process.env.DATABASE_URL;
  if (!connectionString || connectionString.trim() === "") {
    throw new Error("ingester: DATABASE_URL is not set (pass createPool(url) or set the env var)");
  }
  return new Pool({ connectionString });
}
