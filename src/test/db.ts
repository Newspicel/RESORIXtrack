/**
 * Test database: a fresh in-memory SQLite with all migrations (incl. guard triggers) per test.
 * Services use the process-wide `db`, which `setDatabase` swaps out.
 */
import { createDb, openSqlite, runMigrations, setDatabase } from "@/server/db"

export function resetTestDb() {
  const sqlite = openSqlite(":memory:")
  runMigrations(createDb(sqlite))
  return setDatabase(sqlite)
}
