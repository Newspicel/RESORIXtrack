/**
 * Dispatches /api/v1/* requests: match the endpoint, authenticate the API key, check the scope, validate
 * query and body with zod, run the handler and shape the response with the endpoint's response schema.
 * Errors are always `{ "error": { "code", "message", "fields"? } }` with the AppError status.
 */
import type { z } from "zod"
import { AppError, NotFound, toAppError, Validation } from "../errors"
import { authenticate, RateLimited, requireScope } from "./auth"
import type { Endpoint } from "./endpoint"
import { ENDPOINTS } from "./endpoints"

export const PREFIX = "/api/v1"

interface Route {
  ep: Endpoint
  re: RegExp
}

const ROUTES: Route[] = ENDPOINTS.map((ep) => ({
  ep,
  re: new RegExp(`^${ep.path.replace(/\{id\}/g, "([1-9]\\d{0,15})")}$`),
}))

const NO_STORE = { "Cache-Control": "no-store" }

export function errorResponse(err: unknown): Response {
  const e = toAppError(err)
  if (!(err instanceof AppError) && e.code === "server_error") console.error("[api]", err)
  const headers: Record<string, string> = { ...NO_STORE }
  if (err instanceof RateLimited) headers["Retry-After"] = String(err.retryAfter)
  if (e.status === 401) headers["WWW-Authenticate"] = 'Bearer realm="RESORIXtrack"'
  return Response.json({ error: e.toJSON() }, { status: e.status, headers })
}

function zodError(err: z.ZodError, where: "query" | "body"): AppError {
  const fields: Record<string, string> = {}
  for (const issue of err.issues) fields[issue.path.join(".") || where] ??= issue.message
  return new Validation(`Invalid ${where}`, { fields })
}

function parse(schema: z.ZodType | undefined, value: unknown, where: "query" | "body"): unknown {
  if (!schema) return {}
  const r = schema.safeParse(value)
  if (!r.success) throw zodError(r.error, where)
  return r.data
}

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new AppError("Request body is not valid JSON", { status: 400, code: "bad_request" })
  }
}

/** Parsed query and body of a request (after authentication, so a bad key answers 401 before 422). */
async function inputs(ep: Endpoint, request: Request, url: URL): Promise<{ query: unknown; body: unknown }> {
  const query = parse(ep.query, Object.fromEntries(url.searchParams), "query")
  const body = ep.body ? parse(ep.body, await readBody(request), "body") : {}
  return { query, body }
}

export function matchRoute(method: string, path: string): { ep: Endpoint; id: number } | "method" | null {
  let pathMatched = false
  for (const r of ROUTES) {
    const m = r.re.exec(path)
    if (!m) continue
    pathMatched = true
    if (r.ep.method === method) return { ep: r.ep, id: m[1] ? Number(m[1]) : 0 }
  }
  return pathMatched ? "method" : null
}

export async function handleRest(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    const path = url.pathname.slice(PREFIX.length).replace(/\/+$/, "") || "/"
    const match = matchRoute(request.method, path)
    if (match === null) throw new NotFound("No such endpoint")
    if (match === "method") throw new AppError("Method not allowed", { status: 405, code: "method_not_allowed" })
    const { ep, id } = match
    let result: unknown
    if (ep.auth === "none") {
      result = await ep.handler({ request, ...(await inputs(ep, request, url)) })
    } else {
      const caller = await authenticate(request)
      if (ep.scope) requireScope(caller, ep.scope)
      result = await ep.handler({ caller, actor: caller.actor, id, ...(await inputs(ep, request, url)) })
    }
    if (!ep.response) return new Response(null, { status: 204, headers: NO_STORE })
    return Response.json(ep.response.parse(result), { status: ep.status, headers: NO_STORE })
  } catch (err) {
    return errorResponse(err)
  }
}
