import { parseArgs } from "node:util"
import { createBackup, rotateBackups } from "@/server/services/backups"

export default {
  summary: "create an encrypted backup now",
  async run(args: string[]) {
    const { values } = parseArgs({
      args,
      options: { auto: { type: "boolean" }, "no-attachments": { type: "boolean" }, label: { type: "string" } },
    })
    const info = await createBackup({
      includeAttachments: !values["no-attachments"],
      label: values.auto ? "auto" : (values.label ?? ""),
    })
    const removed = values.auto ? rotateBackups() : 0
    console.log(`Backup written: ${info.name} (${info.size} bytes); rotated ${removed}.`)
    return 0
  },
}
