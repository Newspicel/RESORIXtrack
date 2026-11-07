import { flushMail } from "@/server/services/mail"
import { sendClockReminders } from "@/worker/jobs"

export default {
  summary: "send clock-out reminders now (the worker does this every 5 minutes)",
  async run() {
    const sent = sendClockReminders()
    await flushMail()
    console.log(`${sent} reminder(s) sent`)
    return 0
  },
}
