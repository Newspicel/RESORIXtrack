# API

REST API for desktop apps, scripts and integrations: `https://<host>/api/v1/…`. The web app itself uses server functions, not this API.

| | |
|---|---|
| Reference (signed in) | `/api/v1/docs` |
| OpenAPI 3.1 | `/api/v1/openapi.json` (signed in or with an API key) |

## Authentication

API keys only; cookies are ignored on `/api/v1`.

1. Profile → API keys → *New key*: name, permissions (scopes), validity (30, 90, 180 or 365 days), your password.
2. Copy the key (`rt_…`); it is shown once.
3. Send it as `Authorization: Bearer rt_…`.

A key acts as its owner, narrowed to its scopes; it never sees more than the owner may. It stops working when it expires, is revoked, the owner changes or resets the password, or the account is deactivated. Administrators can switch API keys off company-wide (Settings → Security).

| Scope | Allows |
|---|---|
| `time:read` | Clock state, days, time entries, balance |
| `time:write` | Clock actions, offline sync, create, change and delete entries |
| `absences:read` | Vacation account, absence types, absences |
| `absences:write` | Request and cancel absences |
| `reports:read` | Reports; people list for leads and HR |

Send `X-Client: desktop/<version>` to mark entries as "Desktop app" in the change history.

```bash
H="Authorization: Bearer rt_..."
B=https://time.example.com/api/v1
curl -H "$H" $B/me
curl -H "$H" $B/clock
curl -X POST -H "$H" -H "X-Client: desktop/1.0" $B/clock/in
curl -H "$H" "$B/entries?from=2026-11-01&to=2026-11-30"
```

## Conventions

- Dates `YYYY-MM-DD` in the person's timezone; instants ISO 8601 UTC (`…Z`); durations in minutes.
- Clock actions are idempotent and accept an optional past time for offline sync; future times are refused.
- Out-of-scope ids answer `404`.

## Errors

JSON, always:

```json
{ "error": { "code": "validation_error", "message": "Invalid body", "fields": { "start": "Required" } } }
```

| Status | Typical codes |
|---|---|
| 401 | `unauthorized` (missing, invalid or expired key) |
| 403 | `insufficient_scope`, `forbidden`, `api_keys_disabled` |
| 404 | `not_found` |
| 409 | `period_signed_off`, `employment_ended`, `overlap` |
| 422 | `validation_error` (with `fields`) |
| 429 | `too_many_requests` (per-key limit: burst 120, 2 per second; see `Retry-After`) |

## Endpoints

See the OpenAPI document at `/api/v1/openapi.json` or the reference at `/api/v1/docs`.
