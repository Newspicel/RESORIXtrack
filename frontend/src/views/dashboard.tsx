// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { useEffect, useState } from "preact/hooks";
import { Icon } from "../components/icons";
import { Shell, fmtClock } from "../components/Shell";
import { Confirm, Duration, ErrorBox, Loading, StatusBadge, useAsync } from "../components/ui";
import { api } from "../lib/api";
import { clock, clockAction, clockBusy, liveSinceSeconds, liveWorked } from "../lib/clock";
import { absenceLabel, holidayName, t, tError } from "../lib/i18n";
import { bumpData, dataVersion, me, pendingApprovals, toast } from "../lib/store";
import { fmtDate, fmtDays, fmtDuration, fmtTime, todayIn, weekdayName } from "../lib/time";
import { GettingStarted } from "./getting_started";
import { TodayWorkLog, worklogConfig } from "./worklog";

export function DashboardPage() {
  return (
    <Shell active="dashboard" title={t("nav.dashboard")}>
      <Dashboard />
    </Shell>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 11 ? t("dashboard.morning") : h < 17 ? t("dashboard.afternoon") : t("dashboard.evening");
}

function Dashboard() {
  const { data, loading, error, reload } = useAsync(() => api.get<any>("/me/summary"), [dataVersion.value]);
  const [confirmSick, setConfirmSick] = useState(false);
  useEffect(() => {
    const id = setInterval(reload, 120000);
    return () => clearInterval(id);
  }, []);
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox error={error} />;
  const user = me.value!.user;
  const today = data.today;
  const week = data.week;
  const vac = data.vacation;
  const bal = data.balance;
  return (
    <div class="stack lg">
      <div class="page-head">
        <div>
          <h1>{greeting()}, {user.name.split(" ")[0]}</h1>
          <p class="muted">{fmtDate(today.date, { weekday: "long", day: "numeric", month: "long" })}
            {today.holiday && <> · <span class="badge swiss">{holidayName(today.holiday.name)}</span></>}
          </p>
        </div>
        {pendingApprovals.value > 0 && (
          <a class="btn" href="/team/approvals"><Icon.inbox />{t("dashboard.pending_approvals", { count: pendingApprovals.value })}</a>
        )}
      </div>

      {me.value!.mfa_required && !me.value!.mfa_enabled && (
        <div class="alert warn row" style="gap:10px"><Icon.shield width={18} style="flex:none" /><span>{t("dashboard.mfa_nag")} <a href="/profile#mfa">{t("nav.profile")}</a>.</span></div>
      )}
      {me.value!.permissions.admin && <GettingStarted />}

      <ClockCard today={today} sick={data.sick_report} onSick={() => setConfirmSick(true)} />

      {worklogConfig().mode !== "off" && today.worked_min > 0 && <TodayWorkLog day={today} />}

      <div class="grid cols-4">
        <div class="card stat">
          <div class="label">{t("dashboard.today")}</div>
          <div class="value">{fmtDuration(liveWorked())}</div>
          <div class="hint">{t("dashboard.of_target", { target: fmtDuration(today.target_min) })}</div>
          <div class="progress" style="margin-top:10px"><span style={{ width: `${today.target_min ? Math.min(100, (liveWorked() / today.target_min) * 100) : 0}%` }} /></div>
        </div>
        <div class="card stat">
          <div class="label">{t("dashboard.this_week")}</div>
          <div class="value">{fmtDuration(week.worked_min)}</div>
          <div class="hint">{t("dashboard.of_target", { target: fmtDuration(week.target_total_min) })}</div>
          {!!me.value!.weekly_max_minutes && week.worked_min > me.value!.weekly_max_minutes! && (
            <div class="hint neg">{t("dashboard.weekly_max_exceeded", { max: fmtDuration(me.value!.weekly_max_minutes!) })}</div>
          )}
          <div class="progress" style="margin-top:10px"><span style={{ width: `${week.target_total_min ? Math.min(100, (week.worked_min / week.target_total_min) * 100) : 0}%` }} /></div>
        </div>
        <a class="card stat" href="/account" style="text-decoration:none;color:inherit">
          <div class="label">{t("dashboard.balance")}</div>
          <div class="value"><Duration min={bal.balance_min} signed /></div>
          <div class="hint">{t("dashboard.balance_hint", { date: fmtDate(bal.as_of, { day: "numeric", month: "short" }) })}</div>
        </a>
        <a class="card stat" href="/absences" style="text-decoration:none;color:inherit">
          <div class="label">{t("dashboard.vacation")}</div>
          <div class="value num">{fmtDays(vac.remaining)} <span class="small muted" style="font-weight:500">{t("common.days")}</span></div>
          <div class="hint">{t("dashboard.vacation_hint", { taken: fmtDays(vac.taken), planned: fmtDays(vac.planned), total: fmtDays(vac.entitlement + vac.carried_over + vac.adjustments) })}</div>
        </a>
      </div>

      <div class="grid cols-3">
        <div class="card" style="grid-column: span 2">
          <div class="card-head"><h2>{t("dashboard.week_title")}</h2><a href="/time" class="small">{t("dashboard.open_time")}</a></div>
          <WeekBars days={data.week_days} />
        </div>
        <div class="card">
          <div class="card-head"><h2>{t("dashboard.upcoming")}</h2><a class="small" href="/absences">{t("dashboard.request")}</a></div>
          {data.upcoming_absences.length === 0 ? <div class="muted small">{t("dashboard.no_upcoming")}</div> : (
            <div class="stack">
              {data.upcoming_absences.map((a: any) => (
                <div key={a.id} class="row">
                  <span class="dot" style={{ background: a.type.color }} />
                  <div class="grow">
                    <div style="font-weight:560">{absenceLabel(a.type)}</div>
                    <div class="small muted">{fmtDate(a.start_date, { day: "numeric", month: "short" })}{a.end_date !== a.start_date && <> – {fmtDate(a.end_date, { day: "numeric", month: "short" })}</>} · {t("absences.n_days", { count: a.days, n: fmtDays(a.days) })}</div>
                  </div>
                  <StatusBadge status={a.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {confirmSick && (
        <Confirm title={t("dashboard.sick_title")} message={t("dashboard.sick_message")} confirmLabel={t("dashboard.sick_confirm")}
          onClose={() => setConfirmSick(false)}
          onConfirm={async () => {
            try {
              await api.post("/absences/sick-today", {});
              toast(t("dashboard.sick_done"));
              bumpData();
            } catch (e: any) {
              toast(tError(e), "error");
            }
          }} />
      )}
    </div>
  );
}

function ClockCard({ today, sick, onSick }: { today: any; sick: { allowed: boolean; reason: string | null }; onSick: () => void }) {
  const c = clock.value;
  if (!c) return <div class="card hero-card"><Loading /></div>;
  const st = c.state;
  const worked = liveWorked();
  const target = today.target_min || 0;
  const pct = target ? Math.min(1, worked / target) : st === "idle" ? 0 : 1;
  const R = 84;
  const C = 2 * Math.PI * R;
  const color = st === "on_break" ? "var(--color-break)" : "url(#ringGrad)";
  const tz = me.value!.user.timezone;
  const sickAbsence = today.absences.find((a: any) => a.category === "sick" && a.status === "approved");
  async function stopAndPrompt() {
    await clockAction("stop");
    const cfg = worklogConfig();
    if (cfg.mode === "required" && today.worklog_required_min > 0 && today.worklog_min < today.worklog_required_min) {
      toast(t("worklog.clock_out_prompt"), "info", 8000);
      setTimeout(() => document.querySelector<HTMLElement>(".worklog-today")?.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
    }
  }
  const sinceDay = st !== "idle" && c.since ? new Date(c.since).toLocaleDateString("en-CA", { timeZone: tz }) : null;
  const overnight = sinceDay !== null && sinceDay < today.date;
  return (
    <div class="card hero-card">
      {overnight && (
        <div class="alert warn row" style="margin-bottom:16px;gap:10px;align-items:flex-start">
          <Icon.alert width={18} style="flex:none;margin-top:2px" />
          <span>{t("dashboard.overnight", { since: fmtDate(sinceDay!, { weekday: "short", day: "numeric", month: "short" }) + " " + fmtTime(c.since, tz) })} <a href="/time?view=week">{t("dashboard.overnight_fix")}</a></span>
        </div>
      )}
      <div class="clock-card">
        <div class="ring">
          <svg viewBox="0 0 200 200">
            <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" style="stop-color:var(--color-brand-bright)" /><stop offset="60%" style="stop-color:var(--color-brand)" /><stop offset="100%" style="stop-color:var(--color-brand-ink)" /></linearGradient></defs>
            <circle class="track" cx="100" cy="100" r={R} fill="none" stroke-width="12" />
            <circle class="prog" cx="100" cy="100" r={R} fill="none" stroke-width="12" stroke={color} stroke-dasharray={C} stroke-dashoffset={C * (1 - pct)} />
          </svg>
          <div class="center">
            <div class="time">{st === "idle" ? fmtDuration(worked) : fmtClock(liveSinceSeconds())}</div>
            <div class={`state state-${st}`}>{st !== "idle" && <span class="pulse" style="margin-right:6px" />}{t(`clock.state.${st}`)}</div>
          </div>
        </div>
        <div class="stack lg" style="position:relative">
          <div>
            <h2 style="font-size:1.35rem">{sickAbsence ? t("dashboard.get_well") : t(`clock.headline.${st}`)}</h2>
            <p class="muted" style="margin-top:6px">
              {st === "idle" && (worked > 0 ? t("dashboard.worked_today", { time: fmtDuration(worked) }) : t("dashboard.not_started"))}
              {st !== "idle" && t("dashboard.since", { time: fmtTime(c.since, tz) })}
              {" · "}{t("dashboard.target_today", { target: fmtDuration(target) })}
              {c.today_break_min > 0 && <> · {t("dashboard.breaks", { time: fmtDuration(c.today_break_min) })}</>}
            </p>
          </div>
          <div class="row wrap">
            {st === "idle" && <button class="btn btn-gradient btn-lg" disabled={clockBusy.value} onClick={() => clockAction("start")}><Icon.play />{t("clock.start_work")}</button>}
            {st === "working" && <>
              <button class="btn btn-warn btn-lg" disabled={clockBusy.value} onClick={() => clockAction("break")}><Icon.coffee />{t("clock.take_break")}</button>
              <button class="btn btn-lg" disabled={clockBusy.value} onClick={stopAndPrompt}><Icon.stop />{t("clock.stop_work")}</button>
            </>}
            {st === "on_break" && <>
              <button class="btn btn-gradient btn-lg" disabled={clockBusy.value} onClick={() => clockAction("resume")}><Icon.play />{t("clock.resume_work")}</button>
              <button class="btn btn-lg" disabled={clockBusy.value} onClick={stopAndPrompt}><Icon.stop />{t("clock.stop_work")}</button>
            </>}
            <a class="btn btn-ghost" href="/time?add=1"><Icon.plus />{t("dashboard.forgot_clock")}</a>
            {sick.allowed && <button class="btn btn-ghost" onClick={onSick}><Icon.thermo />{t("dashboard.report_sick")}</button>}
          </div>
          <div class="tiny faint">{t("clock.shortcuts")} <span class="kbd">S</span> {t("clock.start_stop")} · <span class="kbd">B</span> {t("clock.break_resume")}</div>
        </div>
      </div>
    </div>
  );
}

export function WeekBars({ days }: { days: any[] }) {
  const max = Math.max(60, ...days.map((d) => Math.max(d.worked_min, d.scheduled_min)));
  const todayIso = todayIn(me.value?.user.timezone || "Europe/Zurich");
  return (
    <div class="week-bars">
      {days.map((d) => {
        const h = (d.worked_min / max) * 100;
        const target = (d.scheduled_min / max) * 100;
        const absent = d.absences.some((a: any) => a.status === "approved");
        const cls = d.worked_min > 0 ? (d.worked_min > d.target_min + 5 && d.target_min > 0 ? "over" : "") : absent ? "absent" : d.holiday ? "holiday" : "";
        const barH = d.worked_min > 0 ? h : absent || d.holiday ? target : 0;
        return (
          <div class="col" key={d.date} title={`${fmtDuration(d.worked_min)} / ${fmtDuration(d.target_min)}`}>
            <div class="small num" style="color:var(--color-muted)">{d.worked_min > 0 ? fmtDuration(d.worked_min) : ""}</div>
            <div class="bar-wrap">
              {d.scheduled_min > 0 && <div class="target" style={{ bottom: `${target}%` }} />}
              <div class={`bar ${cls}`} style={{ height: `${barH}%` }} />
            </div>
            <div class={`lbl ${d.date === todayIso ? "today" : ""}`}>{weekdayName(d.weekday)}</div>
          </div>
        );
      })}
    </div>
  );
}
