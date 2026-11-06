# API

RESORIXtrack's web app uses the same REST API that is available to desktop apps and scripts: `https://<your-host>/api/v1/…`. The interactive documentation (Swagger UI) is at **`/api/docs`** and the OpenAPI 3 spec at `/api/openapi.json`; both require you to be signed in.

## Authentication

Two ways:

| | Browser session | Personal access token |
|---|---|---|
| Used by | the web app | desktop apps, scripts, integrations |
| Header | cookie + `X-CSRF-Token` on writes | `Authorization: Bearer rt_…` |
| Lifetime | sliding, max 90 days | 90 days by default, 365 at most |
| Scope | everything the role allows | only the scopes chosen at creation |

**Create a token** under *Profile & security → API tokens* (your name at the bottom of the sidebar, or the avatar menu): name, scopes, expiry, and your password. The secret is shown once. Tokens are stored hashed and can be revoked any time; they are also revoked automatically when the password changes or the account is deactivated.

Scopes: `clock` (clock in/out), `entries:read`, `entries:write`, `absences:read`, `absences:write`, `reports:read`, and `admin` (administrators only, 90 days max). Account-level routes (sessions, tokens, password, profile changes) are never available to tokens.

**Audit.** Every token is a first-class, auditable credential:

- creation and revocation (by the owner, by an administrator with a reason, or automatically after a password/account change) are written to the audit log with scopes and expiry;
- every call increments the token's use counter and records the last-used time and IP; the first call per day and per IP address is written to the sign-in log (`API token "<name>" · <X-Client> · <User-Agent>`), visible to the owner under *Recent sign-ins* and to administrators under *Backups & logs → Sign-in log*;
- administrators see all tokens of the company under *Backups & logs → API tokens* (owner, permissions, expiry, last use, usage) and can revoke any of them; the owner is notified;
- *Settings → General → Allow personal API tokens* switches the feature off company-wide (existing tokens stop working immediately).

**Apps get their token by signing in.** A desktop or mobile app does not need the web UI: `POST /auth/token` with `{"email", "password", "name": "<device name>", "scopes": [...], "expires_in_days": 90}` returns a personal access token (shown once) plus the user profile. When two-factor authentication is enabled for the account, the first answer is `401 mfa_required`; the app asks for the authenticator (or recovery) code and repeats the call with `"code"`. The same throttling and sign-in log apply as for the web sign-in, the token is audited like one created in the profile, and it never gets more than its owner may do; `admin` scope is available to administrators only. Revoke it with `DELETE /tokens/{id}` from a web session or let it expire.

There is no other way to call the API: no API keys shared between people, no basic auth. A token always belongs to one person and acts with that person's permissions, narrowed by its scopes.

**Data isolation holds for tokens exactly as for the web app.** An employee's token can read and write that person's own data only; a team lead's token reaches the lead's own teams; HR tokens reach everyone. Every request is checked server-side against the token owner's permissions – a token can never see more than its owner, and usually less (its scopes). The automated isolation tests crawl the whole API with employee and lead tokens against foreign records and fail on any leak.

```bash
TOKEN=rt_...
H="Authorization: Bearer $TOKEN"
B=https://time.example.com/api/v1

curl -H "$H" $B/me                          # who am I, permissions, company
curl -H "$H" $B/clock                       # current state: idle | working | on_break
curl -X POST -H "$H" -H "X-Client: desktop/1.0" $B/clock/start
curl -X POST -H "$H" -H "Content-Type: application/json" -d '{"at":"2026-11-05T07:58:00Z"}' $B/clock/stop
curl -H "$H" "$B/entries?from=2026-11-01&to=2026-11-30"
curl -H "$H" "$B/days?from=2026-11-02&to=2026-11-08"          # per-day target/worked/absences
curl -H "$H" "$B/reports/timesheet?year=2026&month=11&format=pdf" -o timesheet.pdf
```

## Clock semantics for desktop clients

- Actions: `POST /clock/start`, `/clock/break`, `/clock/resume`, `/clock/stop`. They are **idempotent**: repeating `start` while already working changes nothing.
- An optional `at` timestamp (ISO 8601, UTC or with offset, up to 48 hours in the past) lets a client sync actions it recorded while offline. Future timestamps are rejected.
- Send `X-Client: desktop/<version>` so entries show "Desktop app" as their source in the change history.
- Responses carry the state, the running entry and today's totals; poll `GET /clock` or re-fetch after each action.
- Clocking is refused outside the employment period (`409 employment_ended`) and in signed-off months (`409 period_signed_off`).
- A desktop client can submit the work log too: `POST /worklog` with `{"date": "2026-11-05", "minutes": 90, "project_id": 3, "note": "…"}` – or with exact times instead of a duration: `{"date": "2026-11-05", "start_time": "09:00", "end_time": "10:30", …}` (the duration is derived; timed items of a day must not overlap). Instead of `project_id`, `customer_ref` (free text, up to 60 characters) references a customer; `GET /worklog/customer-refs` lists the caller's recent references (scope `entries:write` or `clock`); `GET /days` returns `worklog_min`, `worklog_required_min` and `worklog_ok` per day so the client can show the requirement.

## Errors

Uniform JSON: `{"error": {"code": "…", "message": "…", "fields": {"field": "reason"}}}` with HTTP status 400/401/403/404/409/422/429. Common codes: `unauthorized`, `insufficient_scope`, `forbidden`, `not_found`, `validation_error`, `overlap`, `absence_overlap`, `period_signed_off`, `too_many_requests`.

## Main resources

| Resource | Routes (prefix `/api/v1`) |
|---|---|
| Session | `POST /auth/login` (answers `{"mfa_required": true, "mfa_token": …}` when 2FA is on), `POST /auth/mfa` (second step), `POST /auth/logout`, `POST /auth/forgot`, `POST /auth/reset`, `POST /auth/accept-invite` |
| Me | `GET /me`, `PATCH /me` (session only), `GET /me/summary`, `GET /me/export` (session only), `GET/POST /auth/mfa/…` (session only), `GET /notifications`, `POST /notifications/read` |
| Clock | `GET /clock`, `POST /clock/{start,break,resume,stop}` |
| Entries | `GET/POST /entries`, `GET/PATCH/DELETE /entries/{id}`, `GET /entries/{id}/history`, `POST /entries/{id}/dispute`, `GET /days` |
| Absences | `GET/POST /absences`, `GET/PATCH /absences/{id}`, `POST /absences/{id}/{approve,reject,cancel}`, `POST /absences/sick-today`, `GET /absences/pending`, `POST /absences/{id}/attachments`, `GET /attachments/{id}`, `GET /calendar/team`, `GET /absence-types` |
| Work log | `GET /worklog?from&to[&user_id]`, `POST /worklog`, `PATCH /worklog/{id}`, `DELETE /worklog/{id}`, `GET /projects` (any token that may clock or read entries). `POST /projects`, `PATCH /projects/{id}` (leads, Projects capability) are web-session only |
| Accounts | `GET /accounts/{user_id}/time`, `GET /accounts/{user_id}/vacation`, `GET /accounts/{user_id}/balance`, `POST /accounts/{user_id}/adjustments` |
| Reports | `GET /reports/{timesheet,balances,absences,projects,entries}?format=json|pdf|xlsx|csv` |
| Sign-off | `GET /signoffs`, `GET /signoffs/overview`, `POST /signoffs`, `POST /signoffs/{id}/reopen`, `GET /signoffs/verify` |
| Organisation | `GET /users`, `GET /users/{id}`, `GET /teams`, `GET /teams/{id}/leads`, `POST /teams/{id}/leads` (leads/deputies with `valid_from`/`valid_to`), `DELETE /teams/{id}/leads/{row}`, `GET /holiday-calendars` (admin routes for writing); HR: `GET /users/{id}/export`; admin: `POST /users/{id}/anonymize`, `POST /users/{id}/mfa/reset` |
| Administration (`admin` scope) | `GET/PATCH /admin/settings`, `GET /admin/backups`, `POST /admin/backups`, `GET /admin/backups/{name}`, `POST /admin/backups/download`, `GET /admin/audit`, `GET /admin/login-attempts`, `GET /admin/api-tokens`, `DELETE /admin/api-tokens/{id}`, `GET /admin/getting-started` |
| Branding | `GET /branding` (public), `GET /branding/logo/{dark,light}` (public), `PUT/DELETE /branding/logo/{variant}`, `PATCH /branding` (admin) |

Dates are `YYYY-MM-DD` in the person's timezone; instants are ISO 8601 in UTC (`…Z`). Durations are minutes. The spec at `/api/openapi.json` is the authoritative reference for request and response shapes.
