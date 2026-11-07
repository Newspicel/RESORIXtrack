import { parseArgs } from "node:util"
import { formatAccounts, resetDevDatabase, seedDemo } from "@/server/demo"
import { env, isProd } from "@/server/env"

export default {
  summary: "demo company (development only), --reset starts from an empty database",
  async run(args: string[]) {
    const { values } = parseArgs({
      args,
      options: { reset: { type: "boolean", default: false }, password: { type: "string", default: "demo" } },
    })
    if (isProd) {
      console.error("seed-demo is for development only")
      return 1
    }
    if (values.reset) {
      resetDevDatabase(env.databasePath, env.attachmentsDir)
      console.log(`reset ${env.databasePath}`)
    }
    const result = await seedDemo({ password: values.password })
    for (const line of result.lines) console.log(line)
    console.log(`\n${formatAccounts(result.accounts, values.password)}`)
    return 0
  },
}
