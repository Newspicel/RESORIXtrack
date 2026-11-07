import { existsSync, renameSync, rmSync } from "node:fs"
import path from "node:path"
import { parseArgs } from "node:util"
import { createDb, openSqlite, runMigrations } from "@/server/db"
import { env } from "@/server/env"
import { formatReport, ImportError, importV1, openV1, resolveV1Source } from "@/server/import-v1"
import { utcnow } from "@/server/time"

const USAGE =
  "usage: rt import-v1 --data <v1 data dir or .db file> [--signoff-key <key>] [--target <v2 db>] [--dry-run] [--force]"

function hasPeople(file: string): boolean {
  if (!existsSync(file)) return false
  const sqlite = openSqlite(file)
  try {
    const t = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()
    return Boolean(t && (sqlite.prepare<[], { n: number }>("SELECT count(*) AS n FROM users").get()?.n ?? 0) > 0)
  } finally {
    sqlite.close()
  }
}

const SUFFIXES = ["", "-wal", "-shm"]

/** --force on a used target: keep the old database next to it instead of deleting anything. */
function moveAside(file: string): string {
  const aside = `${file}.before-import-${utcnow().slice(0, 19).replaceAll(":", "")}`
  for (const s of SUFFIXES) if (existsSync(file + s)) renameSync(file + s, aside + s)
  return aside
}

function moveBack(aside: string, file: string): void {
  for (const s of SUFFIXES) rmSync(file + s, { force: true })
  for (const s of SUFFIXES) if (existsSync(aside + s)) renameSync(aside + s, file + s)
}

export default {
  summary: "migrate from RESORIXtrack 1.x",
  run(args: string[]) {
    const { values } = parseArgs({
      args,
      options: {
        data: { type: "string" },
        "signoff-key": { type: "string" },
        target: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        force: { type: "boolean", default: false },
      },
    })
    if (!values.data) {
      console.error(USAGE)
      return 1
    }
    const dryRun = values["dry-run"]
    const force = values.force
    try {
      const source = resolveV1Source(values.data)
      const targetFile = path.resolve(values.target ?? env.databasePath)
      if (!dryRun && targetFile === path.resolve(source.dbFile))
        throw new ImportError("target and source are the same file")
      let movedTo: string | null = null
      if (!dryRun && hasPeople(targetFile)) {
        if (!force)
          throw new ImportError(
            `${targetFile} already has people; use --force to set it aside and import into a fresh database`,
          )
        movedTo = moveAside(targetFile)
      }
      const v1 = openV1(source.dbFile)
      const target = openSqlite(dryRun ? ":memory:" : targetFile)
      let ok = false
      try {
        runMigrations(createDb(target))
        const report = importV1(v1, target, {
          sourceDataDir: source.dataDir,
          targetDataDir: dryRun ? null : values.target ? path.dirname(targetFile) : env.dataDir,
          signoffKey: values["signoff-key"],
          force,
          dryRun,
          sourceLabel: source.dbFile,
          targetLabel: dryRun ? "in-memory database (dry run)" : targetFile,
        })
        if (movedTo) report.warnings.push(`previous database kept at ${movedTo}`)
        console.log(formatReport(report))
        ok = true
        return 0
      } finally {
        v1.close()
        target.close()
        if (!ok && movedTo) moveBack(movedTo, targetFile)
      }
    } catch (err) {
      if (err instanceof ImportError) {
        if (err.report) console.error(formatReport(err.report), "\n")
        console.error(`import failed, nothing imported: ${err.message}`)
        return 1
      }
      throw err
    }
  },
}
