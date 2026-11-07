import { apiKeyClient } from "@better-auth/api-key/client"
import { passkeyClient } from "@better-auth/passkey/client"
import { twoFactorClient } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [twoFactorClient(), apiKeyClient(), passkeyClient()],
})
