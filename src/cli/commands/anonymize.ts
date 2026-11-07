import { parseArgs } from "node:util"
import { eq } from "drizzle-orm"
import { db, rawSqlite } from "@/server/db"
import { users } from "@/server/db/schema"
import { AppError } from "@/server/errors"
import { anonymizeUserFromCli } from "@/server/services/users"
import { confirm } from "../prompt"

const USAGE = "usage: rt anonymize --email <email> [--yes]"

/** Irreversible: only for a deactivated former employee whose retention period is over (same rules as the UI). */
export default {
  summary: "anonymise a former employee after the retention period",
  async run(args: string[]) {
    const { values } = parseArgs({ args, options: { email: { type: "string" }, yes: { type: "boolean", short: "y" } } })
    if (!values.email) {
      console.error(USAGE)
      return 2
    }
    const u = db.select().from(users).where(eq(users.email, values.email.trim().toLowerCase())).get()
    if (!u) {
      console.error("no account with this email")
      return 1
    }
    if (!values.yes && !(await confirm(`Anonymise ${u.name} <${u.email}> irreversibly?`))) return 1
    try {
      const r = rawSqlite().transaction(() => anonymizeUserFromCli(u.id))()
      console.log(`anonymised #${u.id}: ${r.documentsRemoved} document(s) removed; time records kept`)
      return 0
    } catch (err) {
      if (err instanceof AppError) {
        console.error(err.message)
        return 1
      }
      throw err
    }
  },
}
