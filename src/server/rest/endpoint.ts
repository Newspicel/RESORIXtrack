/** Endpoint definitions of the REST API: method, path, scope, zod schemas and a thin handler over the services. */
import type { z } from "zod"
import type { Actor } from "../services/permissions"

export const SCOPES = ["time:read", "time:write", "absences:read", "absences:write", "reports:read"] as const
export type Scope = (typeof SCOPES)[number]

export interface Caller {
  actor: Actor
  keyId: number
  scopes: ReadonlySet<string>
  /** Change-log source: `desktop` when the client sends `X-Client: desktop/...`. */
  source: "api" | "desktop"
}

export interface Ctx<Q, B> {
  caller: Caller
  actor: Actor
  /** Numeric `{id}` path parameter (0 when the path has none). */
  id: number
  query: Q
  body: B
}

export type Method = "GET" | "POST" | "PATCH" | "DELETE"

export interface Endpoint {
  method: Method
  path: string
  tag: string
  summary: string
  description?: string
  /** Required scope; null = any valid key. */
  scope: Scope | null
  query?: z.ZodType
  body?: z.ZodType
  /** null = 204 No Content. */
  response: z.ZodType | null
  status: 200 | 201 | 204
  handler: (ctx: Ctx<unknown, unknown>) => unknown
}

type Out<T> = T extends z.ZodType ? z.output<T> : Record<string, never>

/** Typed endpoint: the handler sees parsed query/body and must return the response schema's input. */
export function endpoint<
  Q extends z.ZodType | undefined = undefined,
  B extends z.ZodType | undefined = undefined,
  R extends z.ZodType | null = null,
>(def: {
  method: Method
  path: string
  tag: string
  summary: string
  description?: string
  scope: Scope | null
  query?: Q
  body?: B
  response: R
  status?: 200 | 201 | 204
  handler: (ctx: Ctx<Out<Q>, Out<B>>) => R extends z.ZodType ? z.input<R> : void
}): Endpoint {
  return {
    ...def,
    status: def.status ?? (def.response ? 200 : 204),
    // type erasure for the endpoint list: the router parses query and body with these same schemas first
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    handler: def.handler as Endpoint["handler"],
  }
}
