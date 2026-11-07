import { parseArgs } from "node:util"
import { eq } from "drizzle-orm"
import { db } from "@/server/db"
import { session, users } from "@/server/db/schema"
import { env } from "@/server/env"
import { grantBreakGlass } from "@/server/services/break-glass"
import { setPassword } from "@/server/services/user-auth"

/** Break-glass: set a password from the server shell (also allows one password sign-in while OIDC_ONLY is on). */
export default {
  summary: "set a person's password (break-glass)",
  async run(args: string[]) {
    const { values } = parseArgs({ args, options: { email: { type: "string" }, password: { type: "string" } } })
    if (!values.email || !values.password) {
      console.error("usage: rt reset-password --email <email> --password <password>")
      return 1
    }
    const user = db.select().from(users).where(eq(users.email, values.email.trim().toLowerCase())).get()
    if (!user) {
      console.error("no account with this email")
      return 1
    }
    await setPassword(user.id, values.password)
    db.delete(session).where(eq(session.userId, user.id)).run()
    if (env.oidc.only) {
      const until = grantBreakGlass(user.email)
      console.log(`password sign-in allowed once until ${until}`)
    }
    console.log(`password set for #${user.id} ${user.email}; all sessions ended`)
    return 0
  },
}
