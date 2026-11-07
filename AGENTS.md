## Non-negotiables
1. Privacy: employees see only their own data, admins see no working times (HR does), leads see their teams only, API keys never exceed their owner and scopes. Out-of-scope ids answer NotFound.
2. Signed-off months are immutable on every level: services, database triggers, seal chain.
3. Every change to time data is logged with who, when, what and why, in the same transaction.
4. Swiss law (ArG, ArGV 1, OR, revDSG) as described in `docs/compliance.md`. Time records are kept at least 5 years.
5. Backups are always encrypted. Passwords are Argon2id. Never store or log a plaintext secret.
6. Tests are part of the work. Every write path tests permissions and sign-off locks.
7. Fix problems directly if you find them, without asking.

## Coding structure
- Business logic lives in synchronous services that take an Actor and throw typed errors. Server functions, REST, worker and CLI stay thin and call the same services.
- One source of truth for types: Drizzle schema for data, zod schemas for inputs, inferred everywhere else.
- Every query hits an index. No N+1. Aggregate a period in one pass.
- UI uses the shared kit only: shadcn components and tokens, the DataTable, charts, form kit and page scaffolding. No hex colours, no one-off styles. Follow `docs/design.md`.
- Every UI string exists in en, de, fr and it. German in Swiss spelling.
- Comments only for rationale a name cannot carry. Prefer clear names and small functions.
- Max 3000 lines per file, 200 lines per function.
- Always use the newest stable versions of every tool and dependency and their current recommended patterns. Check the latest docs before writing.
- Always format, lint, typecheck and test what you changed at the end of every change.
- Write text, docs and UI copy as short as possible. Never use an em dash.
