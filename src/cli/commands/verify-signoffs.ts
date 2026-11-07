import { asc, eq } from "drizzle-orm"
import { db } from "@/server/db"
import { monthSignoffs, users } from "@/server/db/schema"
import { checkUserChain } from "@/server/services/seals"

export default {
  summary: "check every sign-off seal chain (exit 1 on problems)",
  run() {
    const rows = db
      .select({ id: monthSignoffs.id, userId: monthSignoffs.userId, month: monthSignoffs.month, name: users.name })
      .from(monthSignoffs)
      .innerJoin(users, eq(users.id, monthSignoffs.userId))
      .orderBy(asc(monthSignoffs.userId), asc(monthSignoffs.id))
      .all()
    const byId = new Map(rows.map((r) => [r.id, r]))
    let problems = 0
    for (const userId of new Set(rows.map((r) => r.userId))) {
      for (const [id, status] of checkUserChain(userId)) {
        if (status === "ok") continue
        const r = byId.get(id)!
        console.log(`${r.name} ${r.month} (#${id}): ${status}`)
        problems++
      }
    }
    const people = new Set(rows.map((r) => r.userId)).size
    console.log(
      problems
        ? `${problems} of ${rows.length} sign-offs failed`
        : `${rows.length} sign-offs of ${people} people intact`,
    )
    return problems ? 1 : 0
  },
}
