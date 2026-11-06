// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import "../styles/admin.css";
import { useMemo, useState } from "preact/hooks";
import { Icon } from "../components/icons";
import { Shell } from "../components/Shell";
import { Avatar, Confirm, Empty, ErrorBox, Field, Loading, Modal, PageHead, useAction, useAsync } from "../components/ui";
import { PersonPicker, type Person } from "../components/person_picker";
import { api } from "../lib/api";
import { fmtDate } from "../lib/time";
import { t } from "../lib/i18n";
import type { User } from "../lib/store";
import { safely, val } from "./admin_common";

interface Team {
  id: number; name: string; color: string; leads: LeadRow[]; lead_names: string[]; deputy_names: string[];
  holiday_calendar_id: number | null; member_count: number; member_ids: number[];
}
interface Calendar { id: number; name: string; is_default: boolean }

export function AdminTeamsPage() {
  return (
    <Shell active="teams" adminOnly title={t("admin.teams.title")}>
      <Teams />
    </Shell>
  );
}

function Teams() {
  const teams = useAsync(() => api.get<Team[]>("/teams"), []);
  const users = useAsync(() => api.get<User[]>("/users"), []);
  const cals = useAsync(() => api.get<Calendar[]>("/holiday-calendars"), []);
  const [editing, setEditing] = useState<Team | "new" | null>(null);
  const [deleting, setDeleting] = useState<Team | null>(null);
  const byId = useMemo(() => new Map((users.data || []).map((u) => [u.id, u])), [users.data]);
  const calName = (id: number | null) => {
    if (id === null) return t("admin.teams.calendar_default");
    return (cals.data || []).find((c) => c.id === id)?.name || "–";
  };
  const reloadAll = () => { teams.reload(); users.reload(); };
  const noTeam = (users.data || []).filter((u) => !u.team_id);

  return (
    <div>
      <PageHead title={t("admin.teams.title")} sub={t("admin.teams.sub")}
        actions={<button class="btn btn-gradient" onClick={() => setEditing("new")}><Icon.plus />{t("admin.teams.new")}</button>} />
      <ErrorBox error={teams.error} />
      {teams.loading && !teams.data ? <Loading /> : (teams.data || []).length === 0 ? (
        <div class="card"><Empty icon={<Icon.team />} title={t("admin.teams.empty")}>{t("admin.teams.empty_help")}</Empty></div>
      ) : (
        <div class="team-grid">
          {(teams.data || []).map((tm) => (
            <div key={tm.id} class="card team-card" style={{ "--team-color": tm.color }}>
              <div class="row between">
                <h2 class="row" style="gap:10px"><span class="dot" style={{ background: tm.color, width: "12px", height: "12px" }} />{tm.name}</h2>
                <div class="row" style="gap:2px">
                  <button class="btn btn-ghost btn-icon btn-sm" aria-label={t("common.edit")} onClick={() => setEditing(tm)}><Icon.edit /></button>
                  <button class="btn btn-ghost btn-icon btn-sm" aria-label={t("common.delete")} onClick={() => setDeleting(tm)}><Icon.trash /></button>
                </div>
              </div>
              <div class="stack sm small">
                <div class="row between"><span class="muted">{t("admin.teams.lead")}</span>
                  {tm.lead_names.length ? <span>{tm.lead_names.join(", ")}</span> : <span class="badge warn">{t("admin.teams.no_lead")}</span>}</div>
                {tm.deputy_names.length > 0 && <div class="row between"><span class="muted">{t("admin.teams.deputies")}</span><span>{tm.deputy_names.join(", ")}</span></div>}
                <div class="row between"><span class="muted">{t("admin.teams.calendar")}</span><span>{calName(tm.holiday_calendar_id)}</span></div>
                <div class="row between"><span class="muted">{t("admin.teams.members")}</span><span class="num">{tm.member_count}</span></div>
              </div>
              <div class="avatars">
                {tm.member_ids.map((id) => byId.get(id)).filter(Boolean).map((u) => (
                  <span key={u!.id} title={u!.name}><Avatar name={u!.name} size="sm" /></span>
                ))}
              </div>
              {tm.lead_names.length === 0 && <div class="tiny muted">{t("admin.teams.no_lead_help")}</div>}
            </div>
          ))}
        </div>
      )}
      {noTeam.length > 0 && (
        <div class="card" style="margin-top:18px">
          <div class="card-head"><h3>{t("admin.teams.without_team", { count: noTeam.length })}</h3></div>
          <div class="avatars" style="gap:12px">
            {noTeam.map((u) => <span key={u.id} class="row small" style="gap:6px"><Avatar name={u.name} size="sm" />{u.name}</span>)}
          </div>
        </div>
      )}
      {editing && (
        <TeamModal team={editing === "new" ? null : editing} users={users.data || []} calendars={cals.data || []}
          onClose={() => setEditing(null)} onDone={() => { setEditing(null); reloadAll(); }} />
      )}
      {deleting && (
        <Confirm danger title={t("admin.teams.delete_title", { name: deleting.name })} message={t("admin.teams.delete_message")}
          confirmLabel={t("common.delete")} onClose={() => setDeleting(null)}
          onConfirm={async () => { if (await safely(() => api.del(`/teams/${deleting.id}`), t("admin.teams.deleted"))) reloadAll(); }} />
      )}
    </div>
  );
}

export interface LeadRow { id?: number; user_id: number; name?: string | null; role: "lead" | "deputy"; valid_from: string | null; valid_to: string | null; active?: boolean }

/** Editable list of leads and deputies with optional validity periods. */
export function LeadRowsEditor({ rows, users, onChange, allowLeads }: { rows: LeadRow[]; users: Person[]; onChange: (rows: LeadRow[]) => void; allowLeads: boolean }) {
  const [userId, setUserId] = useState<number | null>(null);
  const [role, setRole] = useState<"lead" | "deputy">(allowLeads ? "lead" : "deputy");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  function add() {
    if (!userId) return;
    const u = users.find((x) => x.id === userId);
    onChange([...rows, { user_id: userId, name: u?.name, role, valid_from: from || null, valid_to: to || null }]);
    setUserId(null); setFrom(""); setTo("");
  }
  return (
    <div class="stack sm">
      {rows.length === 0 && <div class="small muted">{t("admin.teams.no_lead_option")}</div>}
      {rows.map((r, i) => (
        <div key={`${r.user_id}-${r.role}-${i}`} class="row small" style="background:var(--color-surface-2);padding:6px 10px;border-radius:8px">
          <Avatar name={r.name || "?"} size="sm" />
          <span class="grow">{r.name || users.find((u) => u.id === r.user_id)?.name}</span>
          <span class={`badge ${r.role === "lead" ? "brand" : ""}`}>{t(`admin.teams.role_${r.role}`)}</span>
          <span class="muted nowrap">{r.valid_from || r.valid_to ? `${r.valid_from ? fmtDate(r.valid_from) : "…"} – ${r.valid_to ? fmtDate(r.valid_to) : "…"}` : t("admin.teams.open_ended")}</span>
          <button type="button" class="btn btn-ghost btn-sm btn-icon" aria-label={t("common.delete")} onClick={() => onChange(rows.filter((_, j) => j !== i))}><Icon.x /></button>
        </div>
      ))}
      <div class="row wrap" style="gap:6px">
        <PersonPicker people={users} value={userId} onChange={setUserId} placeholder={t("admin.teams.pick_person")} ariaLabel={t("common.name")} style="flex:1 1 220px" />
        {allowLeads && (
          <select class="select" style="width:auto" value={role} onChange={(e) => setRole(val(e) as "lead" | "deputy")} aria-label={t("common.role")}>
            <option value="lead">{t("admin.teams.role_lead")}</option><option value="deputy">{t("admin.teams.role_deputy")}</option>
          </select>
        )}
        <input class="input" type="date" style="width:auto" value={from} onInput={(e) => setFrom(val(e))} aria-label={t("admin.teams.valid_from")} />
        <input class="input" type="date" style="width:auto" value={to} min={from || undefined} onInput={(e) => setTo(val(e))} aria-label={t("admin.teams.valid_to")} />
        <button type="button" class="btn btn-sm" disabled={!userId} onClick={add}><Icon.plus />{t("common.add")}</button>
      </div>
      <div class="tiny muted">{t("admin.teams.period_help")}</div>
    </div>
  );
}

function TeamModal({ team, users, calendars, onClose, onDone }: {
  team: Team | null; users: User[]; calendars: Calendar[]; onClose: () => void; onDone: () => void;
}) {
  const [name, setName] = useState(team?.name || "");
  const [color, setColor] = useState(team?.color || "#35a1cc");
  const [leads, setLeads] = useState<LeadRow[]>(team?.leads || []);
  const [calId, setCalId] = useState<number | null>(team?.holiday_calendar_id ?? null);
  const [members, setMembers] = useState<Set<number>>(new Set(team?.member_ids || []));
  const [q, setQ] = useState("");
  const { busy, run, fieldErrors, error } = useAction();
  const active = users.filter((u) => u.is_active);
  const shown = active.filter((u) => !q || u.name.toLowerCase().includes(q.toLowerCase()));
  function toggle(id: number) {
    const next = new Set(members);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setMembers(next);
  }
  async function save(e: Event) {
    e.preventDefault();
    const body = { name, color, holiday_calendar_id: calId, member_ids: [...members],
      leads: leads.map((l) => ({ user_id: l.user_id, role: l.role, valid_from: l.valid_from || null, valid_to: l.valid_to || null })) };
    const r = await run(() => (team ? api.patch(`/teams/${team.id}`, body) : api.post("/teams", body)), t("common.saved"));
    if (r) onDone();
  }
  return (
    <Modal title={team ? t("admin.teams.edit_title") : t("admin.teams.new")} onClose={onClose} footer={<>
      <button class="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
      <button class="btn btn-primary" form="team-form" disabled={busy}>{t("common.save")}</button>
    </>}>
      <form id="team-form" class="stack" onSubmit={save}>
        <ErrorBox error={error} />
        <div class="row" style="align-items:flex-end">
          <Field label={t("common.name")} error={fieldErrors.name} class="grow">
            <input class="input" required value={name} onInput={(e) => setName(val(e))} />
          </Field>
          <Field label={t("admin.teams.color")}>
            <input class="color-input" type="color" value={color} onInput={(e) => setColor(val(e))} aria-label={t("admin.teams.color")} />
          </Field>
        </div>
        <Field label={t("admin.teams.lead")} help={t("admin.teams.lead_help")}>
          <LeadRowsEditor rows={leads} users={active} onChange={setLeads} allowLeads />
        </Field>
        <Field label={t("admin.teams.calendar")}>
          <select class="select" value={calId ?? ""} onChange={(e) => setCalId(val(e) ? Number(val(e)) : null)}>
            <option value="">{t("admin.teams.calendar_default")}</option>
            {calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <div class="field">
          <div class="row between"><label>{t("admin.teams.members")} ({members.size})</label>
            <input class="input" style="height:32px;max-width:200px" type="search" placeholder={t("common.search")} value={q} onInput={(e) => setQ(val(e))} /></div>
          <div class="member-picker">
            {shown.map((u) => (
              <label key={u.id}>
                <input type="checkbox" checked={members.has(u.id)} onChange={() => toggle(u.id)} style="accent-color:var(--color-brand)" />
                <Avatar name={u.name} size="sm" />
                <span class="grow">{u.name}</span>
                {u.team_id && u.team_id !== team?.id && <span class="tiny muted">{t("admin.teams.moves_from", { team: u.team_name || "" })}</span>}
              </label>
            ))}
          </div>
          <div class="help">{t("admin.teams.members_help")}</div>
        </div>
      </form>
    </Modal>
  );
}
