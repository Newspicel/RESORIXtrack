import { queryOptions } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { env } from "@/server/env"
import { authed } from "@/server/middleware"
import { openApiDocument } from "@/server/rest/openapi"

const jsonSchema = z.record(z.string(), z.json())
const jsonContent = z.object({ "application/json": z.object({ schema: jsonSchema }) })

const apiOperation = z.object({
  operationId: z.string(),
  tags: z.array(z.string()),
  summary: z.string(),
  description: z.string().optional(),
  parameters: z
    .array(
      z.object({
        name: z.string(),
        in: z.enum(["path", "query"]),
        required: z.boolean(),
        description: z.string().optional(),
        schema: jsonSchema,
      }),
    )
    .optional(),
  requestBody: z.object({ content: jsonContent }).optional(),
  responses: z.record(z.string(), z.object({ description: z.string(), content: jsonContent.optional() })),
  "x-scope": z.string().nullable(),
})

/** The parts of the OpenAPI document the docs page renders, checked so the page can rely on their shape. */
const apiDocument = z.object({
  info: z.object({ title: z.string(), version: z.string(), description: z.string() }),
  servers: z.array(z.object({ url: z.string() })),
  tags: z.array(z.object({ name: z.string() })),
  paths: z.record(z.string(), z.record(z.string(), apiOperation)),
  components: z.object({ schemas: z.record(z.string(), jsonSchema) }),
})

export type JsonSchema = z.infer<typeof jsonSchema>
export type JsonValue = JsonSchema[string]
export type ApiOperation = z.infer<typeof apiOperation>
export type ApiDocument = z.infer<typeof apiDocument>

/** The OpenAPI document of the REST API for the docs page (signed-in people only). */
export const fetchApiDocs = createServerFn({ method: "GET" })
  .middleware([authed])
  .handler(() => apiDocument.parse(openApiDocument(env.baseUrl)))

export const apiDocsQuery = queryOptions({ queryKey: ["api-docs"], queryFn: () => fetchApiDocs(), staleTime: Infinity })
