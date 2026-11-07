import { parseArgs } from "node:util"
import { updateSettings } from "@/server/services/settings"
import { createUserWithPassword } from "@/server/services/user-auth"

export default {
  summary: "create an administrator",
  async run(args: string[]) {
    const { values } = parseArgs({
      args,
      options: { email: { type: "string" }, name: { type: "string" }, password: { type: "string" } },
    })
    if (!values.email || !values.name || !values.password) {
      console.error("usage: rt create-admin --email <email> --name <name> --password <password>")
      return 1
    }
    const user = await createUserWithPassword({
      email: values.email,
      name: values.name,
      password: values.password,
      role: "admin",
    })
    updateSettings({ setup_complete: true })
    console.log(`administrator #${user.id} ${user.email} created`)
    return 0
  },
}
