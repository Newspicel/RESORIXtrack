import { generateSetupCode, setupCodeBanner, setupNeeded } from "@/server/services/setup"

export default {
  summary: "print a fresh one-time code for the setup wizard",
  run() {
    if (!setupNeeded()) {
      console.log("Setup is complete; no setup code needed.")
      return 0
    }
    console.log(setupCodeBanner(generateSetupCode()))
    return 0
  },
}
