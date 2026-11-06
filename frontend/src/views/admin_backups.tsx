// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import "../styles/admin.css";
import { useMemo, useState } from "preact/hooks";
import { Icon } from "../components/icons";
import { Shell } from "../components/Shell";
import { Confirm, Empty, ErrorBox, Loading, PageHead, Segmented, Switch, Tabs, useAction, useAsync } from "../components/ui";
import { PersonPicker } from "../components/person_picker";
import { api, download } from "../lib/api";
import { fieldLabel, fmtFieldValue } from "../lib/audit";
import { t } from "../lib/i18n";
import { tz } from "../lib/store";
import type { User } from "../lib/store";
import { fmtDateTime, relativeTime } from "../lib/time";
import { fmtBytes, safely, val } from "./admin_common";

interface Backup { name: string; size: number; created_at: string }

type Tab = "backups" | "audit" | "logins" | "tokens";

export function AdminBackupsPage() {
  return (
    <Shell active="backups" adminOnly title={t("admin.backups.page_title")}>
      <BackupsPage />
    </Shell>
  );
}

function BackupsPage() {
  const initial = (() => {
    const h = location.hash.replace("#", "");
    return (["backups", "audit", "logins", "tokens"].includes(h) ? h : "backups") as Tab;
  })();
  const [tab, setTabState] = useState<Tab>(initial);
  const setTab = (v: Tab) => { setTabState(v); history.replaceState(null, "", `#${v}`); };
  return (
    <div>
      <PageHead title={t("admin.backups.page_title")} sub={t("admin.backups.sub")} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: "backups", label: t("admin.backups.tab_backups") },
        { value: "audit", label: t("admin.backups.tab_audit") },
        { value: "logins", label: t("admin.backups.tab_logins") },
        { value: "tokens", label: t("admin.backups.tab_tokens") },
      ]} />
      {tab === "backups" && <Backups />}
      {tab === "audit" && <Audit />}
      {tab === "logins" && <LoginLog />}
      {tab === "tokens" && <ApiTokens />}
    </div>
  );
}

function Backups() {
  const { data, loading, error, reload } = useAsync(() => api.get<Backup[]>("/admin/backups"), []);
  const [attachments, setAttachments] = useState(true);
  const [del, setDel] = useState<Backup | null>(null);
  const [fresh, setFresh] = useState(false);
  const { busy, run } = useAction();
  return (
    <div class="card">
      <div class="card-head">
        <div><h2>{t("admin.backups.title")} <span class="badge ok" style="vertical-align:middle;margin-left:6px"><Icon.lock width={12} /> {t("admin.backups.encrypted")}</span></h2>
          <p class="card-sub">{t("admin.backups.help")}</p></div>
      </div>
      <div class="alert small" style="margin-bottom:16px"><div class="row" style="align-items:flex-start;gap:10px"><Icon.key width={18} style="flex:none;margin-top:2px" /><span>{t("admin.backups.encrypted_note")}</span></div></div>
      <div class="row wrap" style="margin-bottom:16px">
        <button class="btn btn-primary" disabled={busy} onClick={async () => {
          if (await run(() => api.post("/admin/backups", { include_attachments: attachments }), t("admin.backups.created"))) reload();
        }}><Icon.database />{t("admin.backups.create")}</button>
        <button class="btn" disabled={fresh} onClick={async () => {
          setFresh(true);
          await safely(() => download("/admin/backups/download", undefined, "resorixtrack-backup.zip.enc", "POST"));
          setFresh(false);
          reload();
        }}><Icon.download />{fresh ? t("common.loading") : t("admin.backups.download_fresh")}</button>
        <Switch checked={attachments} onChange={setAttachments} label={t("admin.backups.include_attachments")} />
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (data || []).length === 0 ? <Empty icon={<Icon.database />} title={t("admin.backups.none")} /> : (
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>{t("admin.backups.file")}</th><th>{t("admin.backups.created_at")}</th><th class="n">{t("admin.backups.size")}</th><th /></tr></thead>
            <tbody>{(data || []).map((b) => (
              <tr key={b.name}>
                <td class="mono small">{b.name}
                  {b.name.includes("-auto") && <span class="badge" style="margin-left:8px">{t("admin.backups.auto")}</span>}
                  {b.name.includes("-premigrate") && <span class="badge warn" style="margin-left:8px">{t("admin.backups.premigrate")}</span>}
                </td>
                <td class="small">{fmtDateTime(b.created_at, tz())}</td>
                <td class="n">{fmtBytes(b.size)}</td>
                <td class="n">
                  <div class="row end" style="gap:4px">
                    <button class="btn btn-ghost btn-sm btn-icon" aria-label={t("common.download")} onClick={() => safely(() => download(`/admin/backups/${b.name}`, undefined, b.name))}><Icon.download /></button>
                    <button class="btn btn-ghost btn-sm btn-icon" aria-label={t("common.delete")} onClick={() => setDel(b)}><Icon.trash /></button>
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <div class="alert" style="margin-top:16px">
        <div class="row" style="align-items:flex-start"><Icon.info width={18} style="flex:none;margin-top:2px" />
          <div class="stack sm">
            <strong>{t("admin.backups.restore_title")}</strong>
            <span class="small">{t("admin.backups.restore_help")}</span>
            <div class="code-box">{"docker compose stop app worker\ndocker compose run --rm app flask resorixtrack restore /data/backups/<file>.zip.enc\ndocker compose up -d"}</div>
          </div>
        </div>
      </div>
      {del && <Confirm danger title={t("admin.backups.delete_title")} message={del.name} confirmLabel={t("common.delete")}
        onClose={() => setDel(null)} onConfirm={async () => { if (await safely(() => api.del(`/admin/backups/${del.name}`), t("common.saved"))) reload(); }} />}
    </div>
  );
}

interface Revision {
  id: number; entity: string; entity_id: number; action: string; actor: { id: number; name: string } | null;
  subject_user_id: number | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null;
  changed: string[]; reason: string; source: string; at: string;
}

const ENTITIES = ["time_entry", "absence", "adjustment", "schedule", "entitlement", "user", "attachment", "signoff"];
const PAGE = 50;

function Audit() {
  const users = useAsync(() => api.get<User[]>("/users", { include_inactive: 1 }), []);
  const [userId, setUserId] = useState("");
  const [entity, setEntity] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const params = { user_id: userId || undefined, entity: entity || undefined, from: from && to ? from : undefined, to: from && to ? to : undefined, limit: PAGE, offset };
  const { data, loading, error } = useAsync(() => api.get<{ total: number; items: Revision[] }>("/admin/audit", params), [userId, entity, from, to, offset]);
  const names = useMemo(() => new Map((users.data || []).map((u) => [u.id, u.name])), [users.data]);
  const reset = () => setOffset(0);
  return (
    <div class="card">
      <div class="card-head"><div><h2>{t("admin.audit.title")}</h2><p class="card-sub">{t("admin.audit.sub")}</p></div></div>
      <div class="admin-toolbar">
        <PersonPicker people={users.data || []} value={userId ? Number(userId) : null} onChange={(v) => { setUserId(v ? String(v) : ""); reset(); }}
          placeholder={t("admin.audit.all_people")} ariaLabel={t("admin.audit.person")} />
        <select class="select" value={entity} onChange={(e) => { setEntity(val(e)); reset(); }} aria-label={t("admin.audit.entity")}>
          <option value="">{t("admin.audit.all_entities")}</option>
          {ENTITIES.map((x) => <option key={x} value={x}>{t(`admin.audit.entities.${x}`)}</option>)}
        </select>
        <input class="input" type="date" value={from} onInput={(e) => { setFrom(val(e)); reset(); }} aria-label={t("common.from")} />
        <input class="input" type="date" value={to} onInput={(e) => { setTo(val(e)); reset(); }} aria-label={t("common.to")} />
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : !data || data.items.length === 0 ? <Empty icon={<Icon.history />} title={t("admin.audit.none")} /> : (
        <>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>{t("common.time")}</th><th>{t("admin.audit.actor")}</th><th>{t("admin.audit.action")}</th>
                <th>{t("admin.audit.entity")}</th><th>{t("admin.audit.person")}</th><th>{t("admin.audit.changes")}</th><th>{t("common.reason")}</th></tr></thead>
              <tbody>{data.items.map((r) => (
                <tr key={r.id}>
                  <td class="small nowrap">{fmtDateTime(r.at, tz())}</td>
                  <td class="small">{r.actor?.name || <span class="faint">{t("admin.audit.system")}</span>}</td>
                  <td><span class={`badge ${r.action === "delete" || r.action === "cancel" || r.action === "reject" ? "danger" : r.action === "create" || r.action === "approve" ? "ok" : "brand"}`}>{t(`admin.audit.actions.${r.action}`)}</span></td>
                  <td class="small nowrap">{t(`admin.audit.entities.${r.entity}`)} <span class="faint">#{r.entity_id}</span>
                    {r.source && r.source !== "web" && <span class="tiny faint"> · {r.source}</span>}</td>
                  <td class="small">{r.subject_user_id ? names.get(r.subject_user_id) || `#${r.subject_user_id}` : "–"}</td>
                  <td>
                    <div class="audit-change">
                      {r.action === "create" && !r.before ? <span class="small muted">{t("admin.audit.created")}</span>
                        : r.changed.length === 0 ? <span class="small faint">–</span>
                          : r.changed.slice(0, 4).map((k) => (
                            <span key={k} class="diff"><span class="muted">{fieldLabel(r.entity, k)}</span> <del>{fmtFieldValue(k, r.before?.[k], tz())}</del> → <ins>{fmtFieldValue(k, r.after?.[k], tz())}</ins></span>
                          ))}
                      {r.changed.length > 4 && <span class="tiny faint">+{r.changed.length - 4}</span>}
                    </div>
                  </td>
                  <td class="small" style="max-width:240px">{r.reason || <span class="faint">–</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div class="row between" style="margin-top:12px">
            <span class="small muted">{t("admin.audit.range", { from: offset + 1, to: offset + data.items.length, total: data.total })}</span>
            <div class="row">
              <button class="btn btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}><Icon.chevronLeft />{t("common.previous")}</button>
              <button class="btn btn-sm" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>{t("common.next_period")}<Icon.chevronRight /></button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

interface Attempt {
  id: number; email: string; user_id: number | null; user_name: string | null; ip: string; device: string;
  user_agent: string; success: boolean; reason: string; at: string;
}

function LoginLog() {
  const [email, setEmail] = useState("");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<"all" | "ok" | "failed">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const params = {
    email: query || undefined, success: result === "all" ? undefined : result === "ok",
    from: from && to ? from : undefined, to: from && to ? to : undefined, limit: PAGE, offset,
  };
  const { data, loading, error } = useAsync(
    () => api.get<{ total: number; failed_last_24h: number; items: Attempt[] }>("/admin/login-attempts", params),
    [query, result, from, to, offset]);
  const reset = () => setOffset(0);
  return (
    <div class="card">
      <div class="card-head">
        <div><h2>{t("admin.logins.title")}</h2><p class="card-sub">{t("admin.logins.sub")}</p></div>
        {data && (
          <div class="stat" style="text-align:right">
            <div class="label">{t("admin.logins.failed_24h")}</div>
            <div class={`value ${data.failed_last_24h > 0 ? "danger-text" : ""}`} style="font-size:1.4rem">{data.failed_last_24h}</div>
          </div>
        )}
      </div>
      <form class="admin-toolbar" onSubmit={(e) => { e.preventDefault(); setQuery(email.trim()); reset(); }}>
        <input class="input search" type="search" placeholder={t("admin.logins.search")} value={email}
          onInput={(e) => { setEmail(val(e)); if (!val(e)) { setQuery(""); reset(); } }} aria-label={t("common.email")} />
        <Segmented value={result} onChange={(v) => { setResult(v); reset(); }} options={[
          { value: "all", label: t("common.all") }, { value: "ok", label: t("admin.logins.successful") },
          { value: "failed", label: t("admin.logins.failed") },
        ]} />
        <input class="input" type="date" value={from} onInput={(e) => { setFrom(val(e)); reset(); }} aria-label={t("common.from")} />
        <input class="input" type="date" value={to} onInput={(e) => { setTo(val(e)); reset(); }} aria-label={t("common.to")} />
      </form>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : !data || data.items.length === 0 ? <Empty icon={<Icon.shield />} title={t("admin.logins.none")} /> : (
        <>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>{t("common.time")}</th><th>{t("admin.logins.account")}</th><th>{t("admin.logins.result")}</th>
                <th class="hide-mobile">{t("admin.logins.device")}</th><th class="hide-mobile">{t("admin.logins.ip")}</th></tr></thead>
              <tbody>{data.items.map((a) => (
                <tr key={a.id}>
                  <td class="small nowrap">{fmtDateTime(a.at, tz())}</td>
                  <td class="small"><div>{a.email}</div>{a.user_name && <div class="tiny muted">{a.user_name}</div>}</td>
                  <td>
                    <span class={`badge ${a.success ? "ok" : a.reason === "reset_requested" ? "" : "danger"}`}>
                      {a.success ? t("admin.logins.ok") : a.reason === "reset_requested" ? t("admin.logins.info") : t("admin.logins.failed_badge")}
                    </span>
                    <div class="tiny muted" style="margin-top:3px">{t(`admin.logins.reasons.${a.reason}`) !== `admin.logins.reasons.${a.reason}` ? t(`admin.logins.reasons.${a.reason}`) : a.reason}</div>
                  </td>
                  <td class="small hide-mobile" title={a.user_agent}>{a.device || "–"}</td>
                  <td class="small mono hide-mobile">{a.ip || "–"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div class="row between" style="margin-top:12px">
            <span class="small muted">{t("admin.audit.range", { from: offset + 1, to: offset + data.items.length, total: data.total })}</span>
            <div class="row">
              <button class="btn btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}><Icon.chevronLeft />{t("common.previous")}</button>
              <button class="btn btn-sm" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>{t("common.next_period")}<Icon.chevronRight /></button>
            </div>
          </div>
        </>
      )}
      <p class="tiny muted" style="margin-top:12px">{t("admin.logins.retention_help")}</p>
    </div>
  );
}


function ApiTokens() {
  const [inactive, setInactive] = useState(false);
  const { data, loading, error, reload } = useAsync(() => api.get<any[]>("/admin/api-tokens", { include_inactive: inactive ? 1 : undefined }), [inactive]);
  const [revoke, setRevoke] = useState<any>(null);
  const rows = data || [];
  return (
    <div class="card">
      <div class="card-head">
        <div><h2>{t("admin.tokens.title")}</h2><p class="card-sub">{t("admin.tokens.sub")}</p></div>
        <Switch checked={inactive} onChange={setInactive} label={t("admin.tokens.show_inactive")} />
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : rows.length === 0 ? <Empty icon={<Icon.key />} title={t("admin.tokens.none")} /> : (
        <div class="table-wrap">
          <table class="table">
            <thead><tr>
              <th>{t("admin.tokens.employee")}</th><th>{t("admin.tokens.token")}</th><th>{t("admin.tokens.permissions")}</th>
              <th class="hide-mobile">{t("admin.tokens.created")}</th><th>{t("admin.tokens.expires")}</th><th>{t("admin.tokens.last_used")}</th>
              <th class="n">{t("admin.tokens.uses")}</th><th>{t("common.status")}</th><th />
            </tr></thead>
            <tbody>{rows.map((tk) => (
              <tr key={tk.id}>
                <td><div style="font-weight:580">{tk.user.name}</div><div class="tiny muted">{tk.user.email}</div></td>
                <td>{tk.name} <span class="mono tiny faint">{tk.prefix}…</span></td>
                <td class="small mono">{tk.scopes.join(" ")}</td>
                <td class="hide-mobile small muted">{fmtDateTime(tk.created_at, tz())}{tk.created_ip && <div class="tiny faint">{tk.created_ip}</div>}</td>
                <td class="small">{tk.expires_at ? fmtDate(tk.expires_at.slice(0, 10)) : "–"}</td>
                <td class="small">{tk.last_used_at ? <>{relativeTime(tk.last_used_at)}<div class="tiny faint">{tk.last_used_ip}</div></> : <span class="faint">–</span>}</td>
                <td class="n">{tk.use_count}</td>
                <td><span class={`badge ${tk.status === "active" ? "ok" : tk.status === "revoked" ? "danger" : ""}`}>{t(`admin.tokens.status.${tk.status}`)}</span></td>
                <td class="n">{tk.status === "active" && <button class="btn btn-ghost btn-sm" onClick={() => setRevoke(tk)}>{t("admin.tokens.revoke")}</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {revoke && <Confirm danger title={t("admin.tokens.revoke_title", { name: revoke.name, user: revoke.user.name })} message={t("admin.tokens.revoke_message")}
        confirmLabel={t("admin.tokens.revoke")} requireReason={false} onClose={() => setRevoke(null)}
        onConfirm={async (reason) => { if (await safely(() => api.del(`/admin/api-tokens/${revoke.id}`, { reason }), t("admin.tokens.revoked_ok"))) reload(); }} />}
    </div>
  );
}
