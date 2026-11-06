// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { useState } from "preact/hooks";
import { Icon } from "../components/icons";
import { Shell } from "../components/Shell";
import { Avatar, Duration, Empty, ErrorBox, Loading, useAction, useAsync } from "../components/ui";
import { TeamSelect } from "../components/schedule_panel";
import { PersonPicker } from "../components/person_picker";
import { halfLabel } from "../lib/absence";
import { api } from "../lib/api";
import { absenceLabel, holidayName, t } from "../lib/i18n";
import { dataVersion, isManager, me, tz } from "../lib/store";
import { addDays, addMonths, fmtDate, fmtDays, monthEnd, monthName, monthStart, parseDate, todayIn, weekStart, weekday, weekdayName } from "../lib/time";

export function TeamPage() {
  return (
    <Shell active="team" title={isManager() ? t("nav.team") : t("nav.team_calendar")}>
      <TeamOverview />
    </Shell>
  );
}

interface CalAbsence { id: number | null; type: string; label: string; color: string; status: string; halves: string[]; category: string }
interface CalDay { date: string; workday: boolean; holiday: { name: string; fraction: number } | null; absences: CalAbsence[] }
interface CalRow { user: { id: number; name: string; team_id: number | null }; days: CalDay[] }
interface Calendar { from: string; to: string; rows: CalRow[]; teams: { id: number; name: string; color: string }[] }

function absenceTitle(a: CalAbsence): string {
  const half = a.halves.length === 1 ? ` (${halfLabel(a.halves[0])})` : "";
  return `${absenceLabel({ key: a.type, label: a.label })}${half} · ${t(`absences.status.${a.status}`)}`;
}

function TeamOverview() {
  const manager = isManager();
  const today = todayIn(tz());
  const [cursor, setCursor] = useState(monthStart(today));
  const [team, setTeam] = useState("");
  const from = monthStart(cursor);
  const to = monthEnd(cursor);
  const ym = parseDate(from);
  const cal = useAsync(() => api.get<Calendar>("/calendar/team", { from, to, team_id: team }), [from, team, dataVersion.value]);
  const ws = weekStart(today);
  const week = useAsync(() => api.get<Calendar>("/calendar/team", { from: ws, to: addDays(ws, 6), team_id: team }), [team, dataVersion.value]);
  const bal = useAsync(() => (manager ? api.get<any>("/reports/balances", { year: ym.getUTCFullYear(), month: ym.getUTCMonth() + 1, team_id: team, format: "json" }) : Promise.resolve(null)),
    [from, team, dataVersion.value]);

  return (
    <div class="stack lg">
      <div class="page-head">
        <div>
          <h1>{manager ? t("team.title") : t("nav.team_calendar")}</h1>
          <p class="muted">{manager ? t("team.sub") : t("team.sub_employee")}</p>
        </div>
        {manager && (
          <div class="row wrap">
            <TeamSelect value={team ? Number(team) : null} onChange={(v) => setTeam(v ? String(v) : "")} emptyLabel={t("team.all_teams")} style="width:auto;min-width:180px" />
          </div>
        )}
      </div>

      <div class="card">
        <div class="card-head">
          <h2>{t("team.calendar")}</h2>
          <div class="row">
            <button class="btn btn-ghost btn-icon btn-sm" aria-label={t("common.previous")} onClick={() => setCursor(addMonths(cursor, -1))}><Icon.chevronLeft /></button>
            <strong class="nowrap" style="min-width:130px;text-align:center">{monthName(ym.getUTCMonth() + 1)} {ym.getUTCFullYear()}</strong>
            <button class="btn btn-ghost btn-icon btn-sm" aria-label={t("common.next_period")} onClick={() => setCursor(addMonths(cursor, 1))}><Icon.chevronRight /></button>
            {from !== monthStart(today) && <button class="btn btn-sm" onClick={() => setCursor(monthStart(today))}>{t("common.today")}</button>}
          </div>
        </div>
        <ErrorBox error={cal.error} />
        {cal.loading && !cal.data ? <Loading /> : cal.data && <Matrix cal={cal.data} today={today} />}
      </div>

      {me.value?.permissions.lead && <DeputiesCard />}

      <OutCards cal={week.data} today={today} loading={week.loading} link={manager} />

      {manager && <div class="card pad-0">
        <div class="card-head" style="padding:20px 20px 0">
          <h2>{t("team.balances", { month: `${monthName(ym.getUTCMonth() + 1)} ${ym.getUTCFullYear()}` })}</h2>
          <span class="card-sub">{t("team.balances_hint")}</span>
        </div>
        <ErrorBox error={bal.error} />
        {bal.loading && !bal.data ? <Loading /> : bal.data && <BalancesTable rows={bal.data.rows} />}
      </div>}
    </div>
  );
}

function OutCards({ cal, today, loading, link }: { cal: Calendar | null; today: string; loading: boolean; link: boolean }) {
  const Person = ({ id, name, class: cls }: { id: number; name: string; class?: string }) =>
    link ? <a class={cls} href={`/team/member?id=${id}`} style="color:inherit">{name}</a> : <span class={cls}>{name}</span>;
  if (loading && !cal) return <div class="card"><Loading /></div>;
  const outToday: { name: string; id: number; a: CalAbsence }[] = [];
  const outWeek = new Map<number, { name: string; items: { date: string; a: CalAbsence }[] }>();
  for (const r of cal?.rows || []) {
    for (const d of r.days) {
      for (const a of d.absences) {
        if (a.status !== "approved" && a.status !== "pending") continue;
        if (d.date === today) outToday.push({ name: r.user.name, id: r.user.id, a });
        if (!d.workday) continue;
        const e = outWeek.get(r.user.id) || { name: r.user.name, items: [] };
        e.items.push({ date: d.date, a });
        outWeek.set(r.user.id, e);
      }
    }
  }
  return (
    <div class="grid cols-2">
    <div class="card">
      <div class="card-head"><h2>{t("team.out_today")}</h2><span class="badge">{outToday.length}</span></div>
      {outToday.length === 0 ? <p class="muted small">{t("team.everyone_in")}</p> : (
        <div class="stack">
          {outToday.map((x) => (
            <div key={x.id} class="row">
              <Avatar name={x.name} size="sm" />
              <Person id={x.id} name={x.name} class="grow" />
              <span class="chip" style={{ background: x.a.color }}>{absenceLabel({ key: x.a.type, label: x.a.label })}</span>
            </div>
          ))}
        </div>
      )}
    </div>
    <div class="card">
      <div class="card-head"><h2>{t("team.out_week")}</h2><span class="badge">{outWeek.size}</span></div>
      {outWeek.size === 0 ? <p class="muted small">{t("team.nobody_week")}</p> : (
        <div class="stack sm">
          {[...outWeek.entries()].map(([id, e]) => {
            const first = e.items[0];
            const days = e.items.reduce((s, x) => s + (x.a.halves.length === 1 ? 0.5 : 1), 0);
            return (
              <div key={id} class="row small">
                <span class="dot" style={{ background: first.a.color }} />
                <Person id={id} name={e.name} class="grow" />
                <span class="muted nowrap">{weekdayName(weekday(first.date))}{e.items.length > 1 && <>–{weekdayName(weekday(e.items[e.items.length - 1].date))}</>} · {t("absences.n_days", { count: days, n: fmtDays(days) })}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
    </div>
  );
}

function Matrix({ cal, today }: { cal: Calendar; today: string }) {
  if (cal.rows.length === 0) return <Empty title={t("team.no_members")} />;
  const days = cal.rows[0].days;
  const types = new Map<string, { label: string; color: string; key: string }>();
  for (const r of cal.rows) for (const d of r.days) for (const a of d.absences) types.set(a.type, { key: a.type, label: a.label, color: a.color });
  return (
    <div class="stack">
      <div class="matrix-wrap">
        <table class="matrix">
          <thead>
            <tr>
              <th />
              {days.map((d) => {
                const wd = weekday(d.date);
                return (
                  <th key={d.date} class={`${wd >= 5 ? "we" : ""} ${d.date === today ? "today" : ""}`} title={fmtDate(d.date, { weekday: "long", day: "numeric", month: "long" })}>
                    <div>{weekdayName(wd, "narrow")}</div>
                    <div>{Number(d.date.slice(8, 10))}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {cal.rows.map((r) => (
              <tr key={r.user.id}>
                <td class="name">{isManager() ? <a href={`/team/member?id=${r.user.id}`} style="color:inherit">{r.user.name}</a> : r.user.name}</td>
                {r.days.map((d) => {
                  const titles = [fmtDate(d.date, { weekday: "short", day: "numeric", month: "short" })];
                  if (d.holiday) titles.push(holidayName(d.holiday.name));
                  for (const a of d.absences) titles.push(absenceTitle(a));
                  const cls = ["c", !d.workday ? "we" : "", d.holiday ? "hol" : ""].join(" ");
                  return (
                    <td key={d.date} class={cls} title={titles.join("\n")} style={d.date === today ? "box-shadow: inset 0 0 0 1px var(--color-brand)" : undefined}>
                      {d.absences.filter((a) => a.status === "approved" || a.status === "pending").map((a, i) => {
                        const half = a.halves.length === 1 ? a.halves[0] : "";
                        return <span key={i} class={`fill ${half} ${a.status === "pending" ? "pending" : ""}`} style={{ background: a.color }} />;
                      })}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div class="legend">
        {[...types.values()].map((x) => <span key={x.key}><span class="dot" style={{ background: x.color }} />{absenceLabel(x)}</span>)}
        <span><span class="dot" style="background: color-mix(in srgb, var(--color-holiday) 55%, transparent)" />{t("team.legend_holiday")}</span>
        <span><span class="dot" style="background: var(--color-surface-3); background-image: repeating-linear-gradient(45deg, rgba(255,255,255,.5) 0 2px, transparent 2px 4px)" />{t("team.legend_pending")}</span>
        <span><span class="dot" style="background: transparent; border: 1px solid var(--color-border)" />{t("team.legend_free")}</span>
      </div>
    </div>
  );
}

type SortKey = "name" | "target_min" | "worked_min" | "delta_min" | "balance_min" | "vacation_remaining";

export function BalancesTable({ rows }: { rows: any[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  if (!rows.length) return <Empty title={t("team.no_members")} />;
  const sorted = [...rows].sort((a, b) => {
    const va = a[sort.key], vb = b[sort.key];
    return (typeof va === "string" ? va.localeCompare(vb) : va - vb) * sort.dir;
  });
  const maxBal = Math.max(60, ...rows.map((r) => Math.abs(r.balance_min)));
  const th = (key: SortKey, label: string, n = true) => (
    <th class={n ? "n" : ""} style="cursor:pointer;user-select:none" aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
      tabIndex={0} role="button" onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }} onClick={() => setSort({ key, dir: sort.key === key ? (-sort.dir as 1 | -1) : key === "name" ? 1 : -1 })}>
      {label}{sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );
  return (
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            {th("name", t("common.name"), false)}
            <th class="hide-mobile">{t("common.team")}</th>
            {th("target_min", t("team.target"))}
            {th("worked_min", t("team.worked"))}
            {th("delta_min", t("team.delta"))}
            {th("balance_min", t("team.balance"))}
            {th("vacation_remaining", t("team.vacation_left"))}
            <th class="n hide-mobile">{t("team.pending")}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.user_id} class="clickable" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }} onClick={() => (location.href = `/team/member?id=${r.user_id}`)}>
              <td><div class="row" style="gap:10px"><Avatar name={r.name} size="sm" /><a href={`/team/member?id=${r.user_id}`} style="color:inherit;font-weight:560">{r.name}</a></div></td>
              <td class="muted hide-mobile">{r.team || "–"}</td>
              <td class="n"><Duration min={r.target_min} /></td>
              <td class="n"><Duration min={r.worked_min} /></td>
              <td class="n"><Duration min={r.delta_min} signed /></td>
              <td class="n">
                <div class="row end" style="gap:8px">
                  <span class="hide-mobile" style="width:64px;height:6px;border-radius:3px;background:var(--color-surface-3);position:relative;overflow:hidden">
                    <span style={{ position: "absolute", top: 0, bottom: 0, left: r.balance_min >= 0 ? "50%" : `${50 - (Math.abs(r.balance_min) / maxBal) * 50}%`,
                      width: `${(Math.abs(r.balance_min) / maxBal) * 50}%`, background: r.balance_min >= 0 ? "var(--color-pos)" : "var(--color-neg)" }} />
                  </span>
                  <Duration min={r.balance_min} signed />
                </div>
              </td>
              <td class="n">{fmtDays(r.vacation_remaining)}</td>
              <td class="n hide-mobile">{r.vacation_pending ? <span class="badge warn">{fmtDays(r.vacation_pending)}</span> : <span class="faint">–</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


/** Team leads name deputies (Stellvertreter) for their teams, for a period or open-ended. */
function DeputiesCard() {
  const teams = useAsync(() => api.get<any[]>("/teams"), [dataVersion.value]);
  const users = useAsync(() => api.get<any[]>("/users"), []);
  const [adding, setAdding] = useState<number | null>(null);
  const [userId, setUserId] = useState<number | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { busy, run, error } = useAction();
  const led = (teams.data || []).filter((tm) => (me.value?.user.led_team_ids || []).includes(tm.id));
  if (led.length === 0) return null;
  const iAmLead = (tm: any) => tm.leads.some((r: any) => r.user_id === me.value?.user.id && r.role === "lead" && r.active);
  return (
    <div class="card">
      <div class="card-head"><div><h2>{t("team.deputies")}</h2><p class="card-sub">{t("team.deputies_sub")}</p></div></div>
      <ErrorBox error={error} />
      <div class="stack">
        {led.map((tm) => (
          <div key={tm.id} class="stack sm">
            <strong class="row" style="gap:8px"><span class="dot" style={{ background: tm.color }} />{tm.name}</strong>
            {tm.leads.map((r: any) => (
              <div key={r.id} class="row small" style="background:var(--color-surface-2);padding:6px 10px;border-radius:8px">
                <Avatar name={r.name || "?"} size="sm" /><span class="grow">{r.name}</span>
                <span class={`badge ${r.role === "lead" ? "brand" : ""}`}>{t(`admin.teams.role_${r.role}`)}</span>
                <span class="muted nowrap">{r.valid_from || r.valid_to ? `${r.valid_from ? fmtDate(r.valid_from) : "…"} – ${r.valid_to ? fmtDate(r.valid_to) : "…"}` : t("admin.teams.open_ended")}</span>
                {!r.active && <span class="badge">{t("team.deputy_not_active")}</span>}
                {r.role === "deputy" && iAmLead(tm) && <button class="btn btn-ghost btn-sm btn-icon" aria-label={t("common.delete")} disabled={busy}
                  onClick={async () => { if (await run(() => api.del(`/teams/${tm.id}/leads/${r.id}`), t("common.saved"))) teams.reload(); }}><Icon.x /></button>}
              </div>
            ))}
            {iAmLead(tm) && adding !== tm.id && <div><button class="btn btn-sm" onClick={() => { setAdding(tm.id); setUserId(null); setFrom(""); setTo(""); }}><Icon.plus />{t("team.add_deputy")}</button></div>}
            {adding === tm.id && (
              <form class="row wrap" style="gap:6px" onSubmit={async (e) => {
                e.preventDefault();
                if (await run(() => api.post(`/teams/${tm.id}/leads`, { user_id: userId, role: "deputy", valid_from: from || null, valid_to: to || null }), t("team.deputy_added"))) { setAdding(null); teams.reload(); }
              }}>
                <PersonPicker people={users.data || []} exclude={me.value ? [me.value.user.id] : []} value={userId} onChange={setUserId}
                  placeholder={t("admin.teams.pick_person")} ariaLabel={t("common.name")} style="flex:1 1 220px" />
                <input class="input" type="date" style="width:auto" value={from} onInput={(e) => setFrom((e.target as HTMLInputElement).value)} aria-label={t("admin.teams.valid_from")} />
                <input class="input" type="date" style="width:auto" value={to} min={from || undefined} onInput={(e) => setTo((e.target as HTMLInputElement).value)} aria-label={t("admin.teams.valid_to")} />
                <button class="btn btn-primary btn-sm" disabled={busy || !userId}>{t("common.save")}</button>
                <button type="button" class="btn btn-ghost btn-sm" onClick={() => setAdding(null)}>{t("common.cancel")}</button>
              </form>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
