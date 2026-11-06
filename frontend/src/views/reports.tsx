// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { useState } from "preact/hooks";
import { Icon } from "../components/icons";
import { Shell } from "../components/Shell";
import { Duration, Empty, ErrorBox, Field, Loading, Segmented, useAsync } from "../components/ui";
import { api, download } from "../lib/api";
import { absenceLabel, holidayName, t, tError } from "../lib/i18n";
import { me, toast, tz } from "../lib/store";
import { fmtDate, fmtDays, fmtDuration, monthEnd, monthName, monthStart, todayIn, weekdayName } from "../lib/time";
import { absenceRange } from "../lib/absence";
import { TeamSelect } from "../components/schedule_panel";
import { PersonPicker } from "../components/person_picker";
import { BalancesTable } from "./team";

export function ReportsPage() {
  return (
    <Shell active="reports" title={t("nav.reports")}>
      <Reports />
    </Shell>
  );
}

type Kind = "timesheet" | "balances" | "absences" | "entries" | "projects";

function Reports() {
  const m = me.value!;
  const manager = m.permissions.hr || m.permissions.lead;
  const today = todayIn(tz());
  const [kind, setKind] = useState<Kind>("timesheet");
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState<number>(Number(today.slice(5, 7)));
  const [wholeYear, setWholeYear] = useState(false);
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(monthEnd(today));
  const [userId, setUserId] = useState(String(m.user.id));
  const [team, setTeam] = useState("");
  const users = useAsync(() => (manager ? api.get<any[]>("/users") : Promise.resolve([m.user])), []);

  const path = `/reports/${kind}`;
  let params: Record<string, string | number | undefined> = {};
  if (kind === "timesheet") params = { user_id: userId, year, month };
  else if (kind === "balances") params = { year, month: wholeYear ? undefined : month, team_id: team || undefined };
  else params = { from, to, team_id: team || undefined };
  const key = JSON.stringify([path, params]);
  const fetched = useAsync(async () => ({ key, data: await api.get<any>(path, { ...params, format: "json" }) }), [key]);
  // Only render data that belongs to the current selection (avoids stale shapes while switching).
  const preview = { ...fetched, data: fetched.data?.key === key ? fetched.data.data : null, loading: fetched.loading || fetched.data?.key !== key };
  const [downloading, setDownloading] = useState<string | null>(null);

  async function dl(fmt: "pdf" | "xlsx" | "csv") {
    setDownloading(fmt);
    try {
      await download(path, { ...params, format: fmt }, `${kind}.${fmt}`);
    } catch (e) {
      toast(tError(e), "error");
    } finally {
      setDownloading(null);
    }
  }

  const kinds: { value: Kind; label: string }[] = [{ value: "timesheet", label: t("reports.timesheet") }];
  if (manager) kinds.push({ value: "balances", label: t("reports.balances") }, { value: "absences", label: t("reports.absences") }, { value: "entries", label: t("reports.raw") });
  if (m.worklog?.mode !== "off") kinds.push({ value: "projects", label: t("reports.projects") });
  const years = Array.from({ length: 6 }, (_, i) => Number(today.slice(0, 4)) - 4 + i);
  const formats: ("pdf" | "xlsx" | "csv")[] = kind === "entries" ? ["xlsx", "csv"] : ["pdf", "xlsx", "csv"];

  return (
    <div class="stack lg">
      <div class="page-head">
        <div>
          <h1>{t("reports.title")}</h1>
          <p class="muted">{t(`reports.desc_${kind}`)}</p>
        </div>
        <div class="row wrap">
          {formats.map((f) => (
            <button key={f} class={`btn ${f === "pdf" ? "btn-primary" : ""}`} disabled={!!downloading || !preview.data} onClick={() => dl(f)}>
              <Icon.download />{downloading === f ? t("common.loading") : f.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div class="card">
        <div class="row wrap" style="gap:16px;align-items:flex-end">
          {kinds.length > 1 && (
            <Field label={t("reports.report")}>
              <Segmented value={kind} options={kinds} onChange={setKind} />
            </Field>
          )}
          {(kind === "timesheet" || kind === "balances") && (
            <>
              <Field label={t("common.year")}>
                <select class="select" style="width:auto" value={year} onChange={(e) => setYear(Number((e.target as HTMLSelectElement).value))}>
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </Field>
              <Field label={t("common.month")}>
                <select class="select" style="width:auto" value={kind === "balances" && wholeYear ? "0" : String(month)}
                  onChange={(e) => {
                    const v = Number((e.target as HTMLSelectElement).value);
                    if (v === 0) setWholeYear(true);
                    else { setWholeYear(false); setMonth(v); }
                  }}>
                  {kind === "balances" && <option value="0">{t("reports.whole_year")}</option>}
                  {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{monthName(i + 1)}</option>)}
                </select>
              </Field>
            </>
          )}
          {(kind === "absences" || kind === "entries" || kind === "projects") && (
            <>
              <Field label={t("common.from")}><input class="input" type="date" value={from} max={to} onChange={(e) => setFrom((e.target as HTMLInputElement).value)} /></Field>
              <Field label={t("common.to")}><input class="input" type="date" value={to} min={from} onChange={(e) => setTo((e.target as HTMLInputElement).value)} /></Field>
            </>
          )}
          {kind === "timesheet" && manager && (
            <Field label={t("reports.person")}>
              <PersonPicker people={users.data || [m.user]} value={userId ? Number(userId) : null} onChange={(v) => v && setUserId(String(v))}
                meId={m.user.id} clearable={false} ariaLabel={t("reports.person")} style="min-width:260px" />
            </Field>
          )}
          {kind !== "timesheet" && (
            <Field label={t("common.team")}><TeamSelect value={team ? Number(team) : null} onChange={(v) => setTeam(v ? String(v) : "")} emptyLabel={t("team.all_teams")} /></Field>
          )}
        </div>
      </div>

      <ErrorBox error={preview.error} />
      {preview.loading && !preview.data ? <Loading /> : preview.data && (
        <div style={preview.loading ? "opacity:.6;transition:opacity .2s" : ""}>
          {kind === "timesheet" && <TimesheetPreview d={preview.data} />}
          {kind === "balances" && <div class="card pad-0"><BalancesTable rows={preview.data.rows} /><BalanceTotals totals={preview.data.totals} /></div>}
          {kind === "absences" && <AbsencesPreview d={preview.data} />}
          {kind === "entries" && <RawPreview rows={preview.data} />}
          {kind === "projects" && <ProjectsPreview d={preview.data} />}
        </div>
      )}
    </div>
  );
}

function BalanceTotals({ totals }: { totals: any }) {
  return (
    <div class="row wrap" style="padding:14px 20px;border-top:1px solid var(--color-border-soft);gap:24px">
      <span class="muted small">{t("common.total")}</span>
      <span class="small">{t("team.target")}: <Duration min={totals.target_min} /></span>
      <span class="small">{t("team.worked")}: <Duration min={totals.worked_min} /></span>
      <span class="small">{t("team.delta")}: <Duration min={totals.delta_min} signed /></span>
      <span class="small">{t("team.balance")}: <Duration min={totals.balance_min} signed /></span>
    </div>
  );
}

function TimesheetPreview({ d }: { d: any }) {
  const today = todayIn(tz());
  const s = d.summary;
  return (
    <div class="stack lg">
      <div class="grid cols-4">
        <div class="card stat"><div class="label">{t("reports.worked")}</div><div class="value">{fmtDuration(s.worked_min)}</div><div class="hint">{t("reports.target_is", { target: fmtDuration(s.target_min) })}</div></div>
        <div class="card stat"><div class="label">{t("reports.delta")}</div><div class="value"><Duration min={s.delta_min} signed /></div><div class="hint">{t("reports.workdays", { n: s.workdays })}</div></div>
        <div class="card stat"><div class="label">{t("reports.balance")}</div><div class="value"><Duration min={d.balance_after_min} signed /></div>
          <div class="hint">{t("reports.balance_before", { value: fmtDuration(d.balance_before_min, { signed: true }) })}</div></div>
        <div class="card stat"><div class="label">{t("reports.vacation_left")}</div><div class="value num">{fmtDays(d.vacation.remaining)} <span class="small muted" style="font-weight:500">{t("common.days")}</span></div>
          <div class="hint">{t("reports.vacation_hint", { taken: fmtDays(d.vacation.taken), planned: fmtDays(d.vacation.planned) })}</div></div>
      </div>
      <div class="card pad-0">
        <div class="card-head" style="padding:18px 20px 0">
          <h2>{d.user.name} · {monthName(d.month)} {d.year}</h2>
          <span class="card-sub">{d.user.timezone}</span>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>{t("common.date")}</th><th>{t("reports.times")}</th><th class="hide-mobile">{t("reports.info")}</th>
                <th class="n hide-mobile">{t("reports.break")}</th><th class="n">{t("reports.worked")}</th><th class="n">{t("reports.target")}</th><th class="n">{t("reports.delta")}</th>
              </tr>
            </thead>
            <tbody>
              {d.days.map((day: any) => {
                const entries = (d.entries[day.date] || []).filter((e: any) => e.kind === "work");
                const cls = day.date === today ? "today" : !day.is_workday && !day.worked_min ? "weekend" : "";
                return (
                  <tr key={day.date} class={cls}>
                    <td class="nowrap"><span class="muted" style="display:inline-block;min-width:40px">{weekdayName(day.weekday)}</span>{fmtDate(day.date, { day: "2-digit", month: "2-digit" })}</td>
                    <td class="num small">
                      {entries.map((e: any, i: number) => (
                        <span key={i} class="nowrap" title={e.note || undefined}>{e.start}–{e.end}{e.edited && <span title={t("reports.edited")} style="color:var(--color-break)"> ✎</span>}{i < entries.length - 1 ? ", " : ""}</span>
                      ))}
                    </td>
                    <td class="hide-mobile">
                      <div class="row wrap" style="gap:4px">
                        {day.holiday && <span class="badge swiss">{holidayName(day.holiday.name)}{day.holiday.fraction < 1 ? " ½" : ""}</span>}
                        {day.absences.map((a: any) => (
                          <span key={a.id} class="chip" style={{ background: a.color, opacity: a.status === "approved" ? 1 : 0.55 }}>
                            {absenceLabel({ key: a.type, label: a.label })}{a.halves.length === 1 ? " ½" : ""}{a.status !== "approved" ? ` (${t(`absences.status.${a.status}`)})` : ""}
                          </span>
                        ))}
                        {day.warnings.includes("break_too_short") && <span class="badge warn">{t("reports.break_warning")}</span>}
                      </div>
                    </td>
                    <td class="n hide-mobile">{day.break_min ? fmtDuration(day.break_min) : ""}</td>
                    <td class="n">{day.worked_min ? fmtDuration(day.worked_min) : ""}</td>
                    <td class="n muted">{day.target_min ? fmtDuration(day.target_min) : ""}</td>
                    <td class="n">{!day.is_future && (day.delta_min || day.target_min) ? <Duration min={day.delta_min} signed /> : ""}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} style="font-weight:650;padding:12px 14px" class="hide-mobile">{t("common.total")}</td>
                <td class="n hide-mobile" />
                <td class="n" style="font-weight:650">{fmtDuration(s.worked_min)}</td>
                <td class="n" style="font-weight:650">{fmtDuration(s.target_min)}</td>
                <td class="n" style="font-weight:650"><Duration min={s.delta_min} signed /></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div class="small muted" style="padding:12px 20px">✎ {t("reports.edited_note")}</div>
      </div>
    </div>
  );
}

function AbsencesPreview({ d }: { d: any }) {
  if (!d.rows.length) return <div class="card"><Empty icon={<Icon.palm />} title={t("reports.no_absences")} /></div>;
  const keyByLabel = new Map<string, string>();
  for (const r of d.rows) keyByLabel.set(r.type, r.type_key);
  const label = (l: string) => absenceLabel({ key: keyByLabel.get(l), label: l });
  const summary = d.summary.filter((s: any) => s.total > 0);
  return (
    <div class="stack lg">
      <div class="card pad-0">
        <div class="card-head" style="padding:18px 20px 0"><h2>{t("reports.summary")}</h2><span class="card-sub">{t("reports.summary_hint")}</span></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>{t("common.name")}</th>{d.types.map((ty: string) => <th key={ty} class="n">{label(ty)}</th>)}<th class="n">{t("common.total")}</th></tr></thead>
            <tbody>
              {summary.length === 0 ? <tr><td colSpan={d.types.length + 2} class="muted">{t("reports.only_pending")}</td></tr> : summary.map((s: any) => (
                <tr key={s.user_id}>
                  <td style="font-weight:560">{s.name}</td>
                  {d.types.map((ty: string) => <td key={ty} class="n">{s.by_type[ty] ? fmtDays(s.by_type[ty]) : <span class="faint">–</span>}</td>)}
                  <td class="n" style="font-weight:650">{fmtDays(s.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div class="card pad-0">
        <div class="card-head" style="padding:18px 20px 0"><h2>{t("reports.details")}</h2></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>{t("common.name")}</th><th>{t("common.type")}</th><th>{t("reports.period")}</th><th class="n">{t("common.days")}</th><th>{t("common.status")}</th></tr></thead>
            <tbody>
              {d.rows.map((r: any) => (
                <tr key={r.id}>
                  <td style="font-weight:560">{r.name}</td>
                  <td><span class="chip" style={{ background: r.color }}>{absenceLabel({ key: r.type_key, label: r.type })}</span></td>
                  <td class="nowrap">{absenceRange(r)}</td>
                  <td class="n">{fmtDays(r.days)}</td>
                  <td><span class={`badge ${r.status === "approved" ? "ok" : "warn"}`}>{t(`absences.status.${r.status}`)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function RawPreview({ rows }: { rows: any[] }) {
  if (!rows.length) return <div class="card"><Empty icon={<Icon.clock />} title={t("reports.no_entries")} /></div>;
  const shown = rows.slice(0, 200);
  return (
    <div class="card pad-0">
      <div class="card-head" style="padding:18px 20px 0">
        <h2>{t("reports.raw")}</h2>
        <span class="card-sub">{rows.length > shown.length ? t("reports.showing", { n: shown.length, total: rows.length }) : t("reports.rows", { n: rows.length })}</span>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>{t("common.name")}</th><th>{t("common.date")}</th><th>{t("reports.times")}</th><th>{t("common.type")}</th><th class="n">{t("reports.minutes")}</th><th>{t("reports.source")}</th><th>{t("reports.flags")}</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.entry_id} style={r.deleted ? "opacity:.5" : ""}>
                <td>{r.name}</td>
                <td class="nowrap">{fmtDate(r.date, { day: "2-digit", month: "2-digit", year: "numeric" })}</td>
                <td class="num nowrap">{r.start_local.slice(11)}–{r.end_local ? r.end_local.slice(11) : "…"}</td>
                <td>{r.kind === "work" ? t("reports.kind_work") : t("reports.kind_break")}</td>
                <td class="n">{fmtDuration(r.minutes)}</td>
                <td class="muted">{t(`reports.source_${r.source}`)}</td>
                <td>
                  <div class="row" style="gap:4px">
                    {r.edited && <span class="badge warn">{t("reports.edited")}</span>}
                    {r.deleted && <span class="badge danger">{t("reports.deleted")}</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


function ProjectsPreview({ d }: { d: any }) {
  return (
    <div class="card">
      <div class="row between wrap" style="margin-bottom:12px">
        <span class="muted small">{t("reports.desc_projects")}</span>
        <span class="small">{t("worklog.report_total")}: <strong class="num">{fmtDuration(d.total_min)}</strong></span>
      </div>
      {d.projects.length === 0 ? <div class="muted small">{t("reports.no_entries")}</div> : (
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>{t("worklog.project")}</th><th>{t("common.team")}</th><th>{t("reports.person")}</th><th class="n">{t("reports.logged")}</th></tr></thead>
            <tbody>{d.projects.flatMap((p: any) => [
              <tr key={p.kind === "customer" ? `c${p.customer_ref}` : `p${p.project_id}`}><td><span class="row" style="gap:8px"><span class="dot" style={{ background: p.color || "var(--color-faint)" }} />
                {p.kind === "customer" && <span class="badge">{t("worklog.customer_short")}</span>}<strong>{p.name || t("worklog.no_project")}</strong>{p.code && <code class="tiny faint">{p.code}</code>}</span></td>
                <td>{p.team || <span class="faint">–</span>}</td><td class="muted small">{p.items}</td><td class="n"><strong>{fmtDuration(p.minutes)}</strong></td></tr>,
              ...p.people.map((x: any) => <tr key={`${p.kind === "customer" ? `c${p.customer_ref}` : `p${p.project_id}`}u${x.user_id}`}><td /><td /><td>{x.name}</td><td class="n">{fmtDuration(x.minutes)}</td></tr>),
            ])}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
