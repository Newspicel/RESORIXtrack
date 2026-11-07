/**
 * Client address behind TRUSTED_PROXIES hops. One helper for the sign-in log, the failed-attempt throttle and
 * Better Auth's rate limiter, which reads it from CLIENT_IP_HEADER: a header only the server sets per request
 * (`withClientIp` strips any incoming value), so every client gets its own bucket and nobody can pick another.
 */
import { env } from "./env"

export const CLIENT_IP_HEADER = "x-resorixtrack-client-ip"

/**
 * Every proxy appends the address it saw to X-Forwarded-For, so with `trustedProxies` hops the client is the
 * entry that many from the right; everything left of it was supplied by the client. Without a trusted proxy
 * forwarded headers are ignored and only X-Real-IP is read.
 */
export function clientIp(headers: Headers | undefined | null, trustedProxies = env.trustedProxies): string {
  if (!headers) return ""
  if (trustedProxies > 0) {
    const xff = headers.get("x-forwarded-for")
    if (xff) {
      const parts = xff
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
      return (parts[Math.max(0, parts.length - trustedProxies)] ?? "").slice(0, 64)
    }
  }
  return (headers.get("x-real-ip") ?? "").slice(0, 64)
}

/** The request with CLIENT_IP_HEADER set to the client address (removed when it is unknown). */
export function withClientIp(request: Request): Request {
  const headers = new Headers(request.headers)
  headers.delete(CLIENT_IP_HEADER)
  const ip = clientIp(headers)
  if (ip) headers.set(CLIENT_IP_HEADER, ip)
  return new Request(request, { headers })
}
