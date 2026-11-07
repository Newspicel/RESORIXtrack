import { heartbeatAge } from "@/worker/heartbeat"

export default {
  summary: "exit 0 when the worker heartbeat is fresh (container health check)",
  run() {
    const age = heartbeatAge()
    return age != null && age < 300 ? 0 : 1
  },
}
