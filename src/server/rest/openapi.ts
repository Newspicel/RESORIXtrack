/** OpenAPI 3.1 document generated from the endpoint table and its zod schemas (`z.toJSONSchema`). */
import { z } from "zod"
import { isRecord, isStringArray } from "@/lib/guards"
import { appVersion } from "../services/backups"
import type { Endpoint } from "./endpoint"
import { ENDPOINTS, TAGS } from "./endpoints"
import { PREFIX } from "./router"
import { ErrorBody } from "./schemas"

type Json = Record<string, unknown>

const REF_PREFIX = "#/components/schemas/"

const obj = (v: unknown): Json => (isRecord(v) ? v : {})

/** Drop `$schema`/`$defs`, point refs at the components, prefer `format` over zod's long patterns. */
function tidy(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(tidy)
  if (!isRecord(v)) return v
  const o: Json = {}
  for (const [k, val] of Object.entries(v)) {
    if (k === "$schema" || k === "$defs") continue
    if (k === "pattern" && "format" in v) continue
    if (k === "$ref" && typeof val === "string") o[k] = val.replace("#/$defs/", REF_PREFIX)
    else o[k] = tidy(val)
  }
  // zod's safe-integer bounds are noise
  if (o.minimum === Number.MIN_SAFE_INTEGER) delete o.minimum
  if (o.maximum === Number.MAX_SAFE_INTEGER) delete o.maximum
  return o
}

/** JSON Schema of `schema` with named sub-schemas as component refs. */
function toSchema(schema: z.ZodType, io: "input" | "output", defs: Json): Json {
  const out = obj(z.toJSONSchema(schema, { target: "draft-2020-12", io, unrepresentable: "any" }))
  for (const [name, def] of Object.entries(obj(out.$defs))) defs[name] ??= tidy(def)
  return obj(tidy(out))
}

const ERROR_STATUSES: Record<string, string> = {
  "401": "Missing, invalid or expired API key",
  "403": "Scope or permission missing",
  "404": "Not found (or not visible to the key's owner)",
  "409": "Conflict (overlap, signed-off month, ...)",
  "422": "Validation failed; `fields` names the problems",
  "429": "Rate limit; see Retry-After",
}

function operationId(ep: Endpoint): string {
  const parts = ep.path
    .split("/")
    .filter(Boolean)
    .map((p) => (p === "{id}" ? "ById" : p.replace(/(^|-)(\w)/g, (_, __, c: string) => c.toUpperCase())))
  return ep.method.toLowerCase() + parts.join("")
}

function operation(ep: Endpoint, defs: Json): Json {
  const parameters: Json[] = []
  if (ep.path.includes("{id}"))
    parameters.push({ name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } })
  if (ep.query) {
    const q = toSchema(ep.query, "input", defs)
    const required = new Set(isStringArray(q.required) ? q.required : [])
    for (const [name, schema] of Object.entries(obj(q.properties))) {
      const { description, ...rest } = obj(schema)
      parameters.push({ name, in: "query", required: required.has(name), description, schema: rest })
    }
  }
  const responses: Json = {}
  responses[String(ep.status)] = ep.response
    ? { description: "OK", content: { "application/json": { schema: toSchema(ep.response, "output", defs) } } }
    : { description: "No content" }
  for (const [status, description] of Object.entries(ERROR_STATUSES))
    responses[status] = { description, content: { "application/json": { schema: { $ref: `${REF_PREFIX}Error` } } } }
  return {
    operationId: operationId(ep),
    tags: [ep.tag],
    summary: ep.summary,
    ...(ep.description ? { description: ep.description } : {}),
    ...(parameters.length ? { parameters } : {}),
    ...(ep.body
      ? {
          requestBody: {
            required: false,
            content: { "application/json": { schema: toSchema(ep.body, "input", defs) } },
          },
        }
      : {}),
    responses,
    security: [{ apiKey: ep.scope ? [ep.scope] : [] }],
    "x-scope": ep.scope,
  }
}

let cached: Json | null = null

export function openApiDocument(baseUrl = ""): Json {
  if (!cached) {
    const defs: Json = {}
    const paths: Json = {}
    for (const ep of ENDPOINTS) {
      paths[ep.path] = { ...obj(paths[ep.path]), [ep.method.toLowerCase()]: operation(ep, defs) }
    }
    toSchema(ErrorBody, "output", defs)
    cached = {
      openapi: "3.1.0",
      info: {
        title: "RESORIXtrack API",
        version: appVersion(),
        description:
          "Personal API keys (Profile > API keys) act as their owner, narrowed to the key's scopes. Instants are ISO 8601 UTC, days YYYY-MM-DD in the person's timezone, durations in minutes.",
      },
      tags: TAGS.map((name) => ({ name })),
      paths,
      components: {
        schemas: Object.fromEntries(Object.entries(defs).sort(([a], [b]) => a.localeCompare(b))),
        securitySchemes: { apiKey: { type: "http", scheme: "bearer", bearerFormat: "rt_..." } },
      },
    }
  }
  return { ...cached, servers: [{ url: `${baseUrl}${PREFIX}` }] }
}
