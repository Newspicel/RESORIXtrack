import path from "node:path"
import { parseArgs } from "node:util"
import { AppError } from "@/server/errors"
import { BackupCryptoError } from "@/server/services/backup-crypto"
import { backupPassword, extractBackup } from "@/server/services/backups"
import { ask } from "../prompt"

const USAGE = "usage: rt decrypt-backup <backup.zip.enc> --out <empty dir> [--ask-password]"

/** Decrypt a v1 or v2 backup into a directory without restoring it (inspection, disaster recovery). */
export default {
  summary: "decrypt a backup into a directory (v1 and v2)",
  async run(args: string[]) {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: { out: { type: "string", short: "o" }, "ask-password": { type: "boolean" } },
    })
    if (positionals.length !== 1 || !values.out) {
      console.error(USAGE)
      return 2
    }
    const out = path.resolve(values.out)
    try {
      const password = values["ask-password"] ? await ask("Backup password: ", true) : backupPassword()
      const r = await extractBackup(positionals[0], password, out)
      const v1 = (r.manifest.version ?? "").startsWith("1.") || (r.manifest.format ?? 0) < 3
      console.log(
        `RESORIXtrack ${r.manifest.version ?? "?"} backup from ${r.manifest.createdAt ?? r.manifest.created_at ?? "?"}: ` +
          `${r.written.length} files written to ${out}${r.verified ? " (checksums ok)" : ""}`,
      )
      if (r.skipped.length) console.log(`skipped unsafe names: ${r.skipped.join(", ")}`)
      if (v1) console.log(`RESORIXtrack 1.x data: import it with rt import-v1 --data ${out}`)
      console.log("The folder holds decrypted personal data: delete it when you are done.")
      return 0
    } catch (err) {
      if (err instanceof BackupCryptoError || err instanceof AppError) {
        console.error(err.message)
        return 1
      }
      throw err
    }
  },
}
