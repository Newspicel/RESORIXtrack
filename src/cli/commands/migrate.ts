import { parseArgs } from "node:util"
import { DatabaseVersionError, migrationStatus, openSqlite, runMigrations, setDatabase } from "@/server/db"
import { env } from "@/server/env"
import { createBackup } from "@/server/services/backups"
import { generateSetupCode, setupCodeBanner, setupNeeded } from "@/server/services/setup"

const USAGE = "usage: rt migrate [--check] [--no-backup]"

export interface MigrateOptions {
  file?: string
  folder?: string
  check?: boolean
  backup?: boolean
  log?: (line: string) => void
}

/**
 * Safe upgrade: refuse v1 and newer databases, back up a used database before pending migrations, apply them
 * all in order, then print the setup code while the first-run setup is open. Returns the exit code.
 */
export async function migrateDatabase(opts: MigrateOptions = {}): Promise<number> {
  const log = opts.log ?? console.log
  const sqlite = openSqlite(opts.file ?? env.databasePath)
  const status = migrationStatus(sqlite, opts.folder)
  if (opts.check) {
    log(status.pending.length ? `pending: ${status.pending.join(", ")}` : "up to date")
    sqlite.close()
    return status.pending.length ? 1 : 0
  }
  const database = setDatabase(sqlite)
  if (status.pending.length) {
    const used =
      !status.fresh && (sqlite.prepare<[], { n: number }>("SELECT count(*) AS n FROM users").get()?.n ?? 0) > 0
    if (used && opts.backup !== false) {
      const info = await createBackup({ includeAttachments: false, label: "premigrate" })
      log(`pre-migration backup: ${info.name}`)
    }
    log(`applying ${status.pending.length} migration(s): ${status.pending.join(", ")}`)
    runMigrations(database, opts.folder)
  } else {
    log("database is up to date")
  }
  if (setupNeeded())
    log(env.setupCodeRequired ? setupCodeBanner(generateSetupCode()) : "first-run setup pending: open the web app")
  return 0
}

export default {
  summary: "apply pending migrations (backup first; --check: exit 1 when pending)",
  async run(args: string[]) {
    let values: { check?: boolean; "no-backup"?: boolean }
    try {
      values = parseArgs({ args, options: { check: { type: "boolean" }, "no-backup": { type: "boolean" } } }).values
    } catch {
      console.error(USAGE)
      return 2
    }
    try {
      return await migrateDatabase({ check: values.check, backup: !values["no-backup"] })
    } catch (err) {
      if (err instanceof DatabaseVersionError) {
        console.error(err.message)
        return 1
      }
      throw err
    }
  },
}
