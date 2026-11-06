// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { useState } from "preact/hooks";
import { Icon } from "../components/icons";
import { Shell } from "../components/Shell";
import { Avatar, Duration, ErrorBox, Field, Loading, Modal, Tabs, useAction, useAsync } from "../components/ui";
import { fieldLabel, fmtFieldValue } from "../lib/audit";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { bumpData, dataVersion, me, type User } from "../lib/store";
import { fmtDate, fmtDateTime, fmtDays, fmtDuration, todayIn, weekdayName } from "../lib/time";
import { AbsencesView, RequestModal } from "./absences";
import { AccountView } from "./account";
import { TimeView } from "./time";
import { SchedulePanel } from "../components/schedule_panel";

type Tab = "time" | "absences" | "account" | "schedule" | "history";

export function MemberPage() {
  return (
    <Shell active="team" title={t("nav.team")} managerOnly>
      <Member />
    </Shell>
  );
}

function Member() {
  const params = new URLSearchParams(location.search);
  const id = Number(params.get("id"));
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "time");
  const m = me.value!;
  const [sick, setSick] = useState(false);
  const user = useAsync(() => api.get<User>(`/users/${id}`), [id, dataVersion.value]);
  const balance = useAsync(() => api.get<any>(`/accounts/${id}/balance`), [id, dataVersion.value]);
  if (user.loading && !user.data) return <Loading />;
  if (!user.data) return user.error && (user.error as any).status !== 404 ? <ErrorBox error={user.error} /> : <div class="alert error">{t("member.not_found")}</div>;
  const u = user.data;
  function changeTab(v: Tab) {
    setTab(v);
    const q = new URLSearchParams(location.search);
    q.set("tab", v);
    history.replaceState(null, "", `?${q}`);
  }
  return (
    <div class="stack lg">
      <a href="/team" class="small"><Icon.chevronLeft width={14} style="vertical-align:-2px" /> {t("member.back")}</a>
      <div class="card hero-card">
        <div class="row wrap" style="gap:18px;position:relative">
          <Avatar name={u.name} />
          <div class="grow">
            <h1 style="font-size:1.4rem">{u.name}</h1>
            <div class="muted small">{u.email}{u.team_name && ` · ${u.team_name}`} · {u.timezone}</div>
          </div>
          {balance.data && (
            <div class="row wrap" style="gap:28px">
              <div class="stat"><div class="label">{t("dashboard.balance")}</div><div class="value" style="font-size:1.35rem"><Duration min={balance.data.time.balance_min} signed /></div></div>
              <div class="stat"><div class="label">{t("dashboard.vacation")}</div><div class="value num" style="font-size:1.35rem">{fmtDays(balance.data.vacation.remaining)}</div></div>
            </div>
          )}
          <div class="row wrap">
            {m.permissions.admin && <a class="btn btn-ghost" href={`/admin/users?edit=${u.id}`}><Icon.edit />{t("member.edit_employee")}</a>}
            <button class="btn" onClick={() => setSick(true)}><Icon.thermo />{t("member.mark_sick")}</button>
          </div>
        </div>
      </div>
      <Tabs value={tab} onChange={changeTab} tabs={[
        { value: "time", label: t("member.tab_time") }, { value: "absences", label: t("member.tab_absences") },
        { value: "account", label: t("member.tab_account") }, { value: "schedule", label: t("member.tab_schedule") },
        { value: "history", label: t("member.tab_history") },
      ]} />
      {tab === "time" && <TimeView user={u} />}
      {tab === "absences" && <AbsencesView user={u} />}
      {tab === "account" && <AccountView user={u} />}
      {tab === "schedule" && <ScheduleView user={u} onChange={user.reload} />}
      {tab === "history" && <ChangeLog user={u} />}
      {sick && <RequestModal user={u} mode="sick" onClose={() => setSick(false)} onDone={() => { setSick(false); bumpData(); }} />}
    </div>
  );
}

function ScheduleView({ user, onChange }: { user: User; onChange: () => void }) {
  const m = me.value!;
  const canEdit = m.permissions.hr || m.permissions.lead_can_edit_schedules;
  return (
    <div class="card">
      <div class="card-head"><h2>{t("member.schedules")}</h2></div>
      <SchedulePanel user={user} canEdit={canEdit} canDelete={m.permissions.hr} onChanged={() => { onChange(); bumpData(); }} />
    </div>
  );
}

function ChangeLog({ user }: { user: User }) {
  const { data, loading } = useAsync(() => api.get<any[]>(`/users/${user.id}/history`), [user.id, dataVersion.value]);
  const tz = me.value!.user.timezone;
  if (loading) return <Loading />;
  return (
    <div class="card pad-0">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>{t("common.time")}</th><th>{t("member.who")}</th><th>{t("member.what")}</th><th>{t("member.changes")}</th><th>{t("common.reason")}</th></tr></thead>
          <tbody>
            {(data || []).map((r) => (
              <tr key={r.id}>
                <td class="nowrap small">{fmtDateTime(r.at, tz)}</td>
                <td class="nowrap">{r.actor?.name || "–"}{r.actor && r.actor.id !== user.id && <span class="badge warn" style="margin-left:6px">{t("time.by_other")}</span>}</td>
                <td class="nowrap">{t(`member.entity.${r.entity}`)} · {t(`member.action.${r.action}`)}</td>
                <td class="small">{r.action === "update" && r.before && r.after ? (
                  <span class="diff">{(r.changed || []).slice(0, 4).map((k: string) => (
                    <span key={k}><span class="muted">{fieldLabel(r.entity, k)}</span> <del>{fmtFieldValue(k, r.before[k], tz)}</del> → <ins>{fmtFieldValue(k, r.after[k], tz)}</ins></span>
                  ))}{(r.changed || []).length > 4 && <span class="tiny faint">+{r.changed.length - 4}</span>}</span>
                ) : <span class="muted">{(r.changed || []).map((k: string) => fieldLabel(r.entity, k)).join(", ")}</span>}</td>
                <td class="small">{r.reason !== "clock" ? r.reason : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
