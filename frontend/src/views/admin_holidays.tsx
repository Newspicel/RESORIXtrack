// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import "../styles/admin.css";
import { useEffect, useState } from "preact/hooks";
import { Icon } from "../components/icons";
import { Shell } from "../components/Shell";
import { Confirm, Empty, ErrorBox, Field, Loading, Modal, PageHead, Switch, useAction, useAsync } from "../components/ui";
import { api } from "../lib/api";
import { holidayName, t } from "../lib/i18n";
import { toast, tz } from "../lib/store";
import { fmtDate, todayIn, weekday, weekdayName } from "../lib/time";
import { safely, val } from "./admin_common";

interface Calendar {
  id: number; name: string; region_code: string; description: string; is_default: boolean;
  holiday_count: number; years: number[]; user_count: number; team_count: number;
}
interface Holiday { id: number; calendar_id: number; date: string; name: string; fraction: number }

export function AdminHolidaysPage() {
  return (
    <Shell active="holidays" adminOnly title={t("admin.holidays.title")}>
      <Holidays />
    </Shell>
  );
}

function Holidays() {
  const cals = useAsync(() => api.get<Calendar[]>("/holiday-calendars"), []);
  const [selected, setSelected] = useState<number | null>(null);
  const [modal, setModal] = useState<null | "new" | "preset">(null);
  useEffect(() => {
    if (selected === null && cals.data?.length) setSelected((cals.data.find((c) => c.is_default) || cals.data[0]).id);
  }, [cals.data]);
  const current = (cals.data || []).find((c) => c.id === selected) || null;
  return (
    <div>
      <PageHead title={t("admin.holidays.title")} sub={t("admin.holidays.sub")} actions={<>
        <button class="btn" onClick={() => setModal("preset")}><Icon.sparkle />{t("admin.holidays.install_preset")}</button>
        <button class="btn btn-gradient" onClick={() => setModal("new")}><Icon.plus />{t("admin.holidays.new_calendar")}</button>
      </>} />
      <ErrorBox error={cals.error} />
      {cals.loading && !cals.data ? <Loading /> : (
        <div class="cal-layout">
          <div class="card stack">
            <h3>{t("admin.holidays.calendars")}</h3>
            {(cals.data || []).length === 0 && <div class="muted small">{t("admin.holidays.no_calendars")}</div>}
            {(cals.data || []).map((c) => (
              <button key={c.id} class={`cal-item ${c.id === selected ? "active" : ""}`} onClick={() => setSelected(c.id)}>
                <div class="row between" style="gap:8px">
                  <strong style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{c.name}</strong>
                  {c.is_default && <span class="badge brand">{t("admin.holidays.default")}</span>}
                </div>
                <div class="tiny muted" style="margin-top:4px">
                  {t("admin.holidays.n_holidays", { count: c.holiday_count })} · {t("admin.holidays.usage", { teams: c.team_count, users: c.user_count })}
                </div>
              </button>
            ))}
            <p class="tiny muted">{t("admin.holidays.resolution_help")}</p>
          </div>
          {current ? <CalendarDetail key={current.id} cal={current} onChanged={cals.reload}
            onDeleted={() => { setSelected(null); cals.reload(); }} /> : <div class="card"><Empty title={t("admin.holidays.select")} /></div>}
        </div>
      )}
      {modal === "new" && <CalendarModal onClose={() => setModal(null)} onDone={(c) => { setModal(null); setSelected(c.id); cals.reload(); }} />}
      {modal === "preset" && <PresetModal onClose={() => setModal(null)} onDone={(c) => { setModal(null); setSelected(c.id); cals.reload(); }} />}
    </div>
  );
}

function CalendarDetail({ cal, onChanged, onDeleted }: { cal: Calendar; onChanged: () => void; onDeleted: () => void }) {
  const thisYear = Number(todayIn(tz()).slice(0, 4));
  const [year, setYear] = useState(cal.years.includes(thisYear) || cal.years.length === 0 ? thisYear : cal.years[cal.years.length - 1]);
  const detail = useAsync(() => api.get<Calendar & { holidays: Holiday[] }>(`/holiday-calendars/${cal.id}`, { year }), [cal.id, year, cal.holiday_count]);
  const [edit, setEdit] = useState<Holiday | "new" | null>(null);
  const [del, setDel] = useState<Holiday | null>(null);
  const [modal, setModal] = useState<null | "rename" | "import" | "delete">(null);
  const years = [...new Set([...cal.years, thisYear, thisYear + 1, year])].sort();
  const reload = () => { detail.reload(); onChanged(); };
  return (
    <div class="card stack lg">
      <div class="row between wrap">
        <div>
          <h2 class="row">{cal.name}{cal.is_default && <span class="badge brand">{t("admin.holidays.default")}</span>}</h2>
          <div class="small muted" style="margin-top:4px">{[cal.region_code, cal.description].filter(Boolean).join(" · ") || t("admin.holidays.no_description")}</div>
        </div>
        <div class="row wrap">
          {!cal.is_default && <button class="btn btn-sm" onClick={() => safely(() => api.patch(`/holiday-calendars/${cal.id}`, { is_default: true }), t("admin.holidays.now_default")).then(onChanged)}>{t("admin.holidays.make_default")}</button>}
          <button class="btn btn-sm" onClick={() => setModal("import")}><Icon.download />{t("admin.holidays.import")}</button>
          <button class="btn btn-sm btn-ghost btn-icon" aria-label={t("common.edit")} onClick={() => setModal("rename")}><Icon.edit /></button>
          <button class="btn btn-sm btn-ghost btn-icon" aria-label={t("common.delete")} onClick={() => setModal("delete")}><Icon.trash /></button>
        </div>
      </div>
      <div class="row between wrap">
        <div class="segmented" role="tablist">
          {years.map((y) => <button key={y} class={y === year ? "active" : ""} onClick={() => setYear(y)}>{y}</button>)}
        </div>
        <button class="btn btn-primary btn-sm" onClick={() => setEdit("new")}><Icon.plus />{t("admin.holidays.add_holiday")}</button>
      </div>
      {detail.loading && !detail.data ? <Loading /> : (detail.data?.holidays || []).length === 0 ? (
        <Empty icon={<Icon.flag />} title={t("admin.holidays.none_in_year", { year })}>{t("admin.holidays.none_help")}</Empty>
      ) : (
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>{t("common.date")}</th><th>{t("common.name")}</th><th class="hide-mobile">{t("admin.holidays.duration")}</th><th /></tr></thead>
            <tbody>
              {detail.data!.holidays.map((h) => {
                const wd = weekday(h.date);
                return (
                  <tr key={h.id} class={wd >= 5 ? "weekend" : ""}>
                    <td class="nowrap"><span class="muted" style="display:inline-block;width:32px">{weekdayName(wd)}</span>{fmtDate(h.date, { day: "numeric", month: "long" })}</td>
                    <td title={h.name}>{holidayName(h.name)}{h.fraction < 1 && <span class="badge warn only-mobile" style="margin-left:6px">½</span>}{wd >= 5 && <div class="tiny faint">{t("admin.holidays.on_weekend")}</div>}</td>
                    <td class="hide-mobile">{h.fraction < 1 ? <span class="badge warn">{t("admin.holidays.half_day")}</span> : <span class="badge">{t("admin.holidays.full_day")}</span>}</td>
                    <td class="n">
                      <button class="btn btn-ghost btn-sm btn-icon" aria-label={t("common.edit")} onClick={() => setEdit(h)}><Icon.edit /></button>
                      <button class="btn btn-ghost btn-sm btn-icon" aria-label={t("common.delete")} onClick={() => setDel(h)}><Icon.trash /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {edit && <HolidayModal cal={cal} holiday={edit === "new" ? null : edit} year={year} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
      {del && <Confirm danger title={t("admin.holidays.delete_holiday", { name: del.name })} confirmLabel={t("common.delete")} onClose={() => setDel(null)}
        onConfirm={async () => { if (await safely(() => api.del(`/holidays/${del.id}`), t("common.saved"))) reload(); }} />}
      {modal === "rename" && <CalendarModal cal={cal} onClose={() => setModal(null)} onDone={() => { setModal(null); onChanged(); }} />}
      {modal === "import" && <ImportModal cal={cal} year={year} onClose={() => setModal(null)} onDone={(y) => { setModal(null); setYear(y); reload(); }} />}
      {modal === "delete" && <Confirm danger title={t("admin.holidays.delete_calendar", { name: cal.name })}
        message={t("admin.holidays.delete_calendar_message", { teams: cal.team_count, users: cal.user_count })}
        confirmLabel={t("common.delete")} onClose={() => setModal(null)}
        onConfirm={async () => { if (await safely(() => api.del(`/holiday-calendars/${cal.id}`), t("common.saved"))) onDeleted(); }} />}
    </div>
  );
}

function CalendarModal({ cal, onClose, onDone }: { cal?: Calendar; onClose: () => void; onDone: (c: Calendar) => void }) {
  const [name, setName] = useState(cal?.name || "");
  const [region, setRegion] = useState(cal?.region_code || "");
  const [description, setDescription] = useState(cal?.description || "");
  const [isDefault, setIsDefault] = useState(cal?.is_default || false);
  const { busy, run, fieldErrors, error } = useAction();
  async function save(e: Event) {
    e.preventDefault();
    const body = { name, region_code: region, description, is_default: isDefault };
    const r = await run(() => (cal ? api.patch<Calendar>(`/holiday-calendars/${cal.id}`, body) : api.post<Calendar>("/holiday-calendars", body)), t("common.saved"));
    if (r) onDone(r);
  }
  return (
    <Modal title={cal ? t("admin.holidays.edit_calendar") : t("admin.holidays.new_calendar")} onClose={onClose} footer={<>
      <button class="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
      <button class="btn btn-primary" form="cal-form" disabled={busy}>{t("common.save")}</button>
    </>}>
      <form id="cal-form" class="stack" onSubmit={save}>
        <ErrorBox error={error} />
        <Field label={t("common.name")} error={fieldErrors.name}><input class="input" required value={name} onInput={(e) => setName(val(e))} placeholder="CH-ZH Zürich" /></Field>
        <Field label={t("admin.holidays.region")} help={t("admin.holidays.region_help")}><input class="input" value={region} onInput={(e) => setRegion(val(e))} placeholder="CH-ZH" /></Field>
        <Field label={t("admin.holidays.description")}><input class="input" value={description} onInput={(e) => setDescription(val(e))} /></Field>
        <Switch checked={isDefault} onChange={setIsDefault} label={t("admin.holidays.use_as_default")} />
      </form>
    </Modal>
  );
}

function HolidayModal({ cal, holiday, year, onClose, onDone }: { cal: Calendar; holiday: Holiday | null; year: number; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(holiday?.date || `${year}-01-01`);
  const [name, setName] = useState(holiday?.name || "");
  const [fraction, setFraction] = useState(holiday?.fraction ?? 1);
  const { busy, run, fieldErrors, error } = useAction();
  async function save(e: Event) {
    e.preventDefault();
    const body = { date, name, fraction };
    const r = await run(() => (holiday ? api.patch(`/holidays/${holiday.id}`, body) : api.post(`/holiday-calendars/${cal.id}/holidays`, body)), t("common.saved"));
    if (r) onDone();
  }
  return (
    <Modal title={holiday ? t("admin.holidays.edit_holiday") : t("admin.holidays.add_holiday")} onClose={onClose} footer={<>
      <button class="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
      <button class="btn btn-primary" form="hol-form" disabled={busy}>{t("common.save")}</button>
    </>}>
      <form id="hol-form" class="stack" onSubmit={save}>
        <ErrorBox error={error} />
        <div class="form-grid">
          <Field label={t("common.date")} error={fieldErrors.date}><input class="input" type="date" required value={date} onInput={(e) => setDate(val(e))} /></Field>
          <Field label={t("admin.holidays.duration")}>
            <select class="select" value={String(fraction)} onChange={(e) => setFraction(Number(val(e)))}>
              <option value="1">{t("admin.holidays.full_day")}</option>
              <option value="0.5">{t("admin.holidays.half_day")}</option>
            </select>
          </Field>
        </div>
        <Field label={t("common.name")} error={fieldErrors.name}><input class="input" required value={name} onInput={(e) => setName(val(e))} /></Field>
        <p class="small muted">{t("admin.holidays.half_day_help")}</p>
      </form>
    </Modal>
  );
}

function ImportModal({ cal, year, onClose, onDone }: { cal: Calendar; year: number; onClose: () => void; onDone: (year: number) => void }) {
  const countries = useAsync(() => api.get<Record<string, string[]>>("/holiday-calendars/countries"), []);
  const [country, setCountry] = useState((cal.region_code || "CH").split("-")[0] || "CH");
  const [subdiv, setSubdiv] = useState((cal.region_code || "").split("-")[1] || "");
  const [y, setY] = useState(year);
  const [halfDays, setHalfDays] = useState(false);
  const [replace, setReplace] = useState(false);
  const { busy, run, error } = useAction();
  const display = (() => {
    try {
      return new Intl.DisplayNames([document.documentElement.lang || "en"], { type: "region" });
    } catch {
      return null;
    }
  })();
  const countryName = (code: string): string => {
    try {
      return display?.of(code) || code;
    } catch {
      return code; // not an ISO region (e.g. financial market calendars)
    }
  };
  const codes = Object.keys(countries.data || {}).sort((a, b) => countryName(a).localeCompare(countryName(b)));
  const subdivs = countries.data?.[country] || [];
  const [confirmReplace, setConfirmReplace] = useState(false);
  async function submit(e: Event) {
    e.preventDefault();
    if (replace && !confirmReplace) { setConfirmReplace(true); return; }
    setConfirmReplace(false);
    const r = await run(() => api.post<{ added: number; skipped: number }>(`/holiday-calendars/${cal.id}/import`, {
      country, subdiv: subdiv || null, year: y, include_half_days: halfDays, replace,
    }));
    if (r) {
      toast(t("admin.holidays.imported", { added: r.added, skipped: r.skipped }));
      onDone(y);
    }
  }
  return (
    <Modal title={t("admin.holidays.import_title")} onClose={onClose} footer={<>
      <button class="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
      <button class="btn btn-primary" form="import-form" disabled={busy || !country}>{t("admin.holidays.import")}</button>
    </>}>
      {confirmReplace && <Confirm danger title={t("admin.holidays.replace_title", { year: y })} message={t("admin.holidays.replace_message")}
        confirmLabel={t("admin.holidays.import")} onClose={() => setConfirmReplace(false)}
        onConfirm={() => submit(new Event("submit"))} />}
      <form id="import-form" class="stack" onSubmit={submit}>
        <p class="small muted">{t("admin.holidays.import_help")}</p>
        <ErrorBox error={error} />
        {countries.loading ? <Loading /> : (
          <div class="form-grid">
            <Field label={t("admin.holidays.country")}>
              <select class="select" value={country} onChange={(e) => { setCountry(val(e)); setSubdiv(""); }}>
                {codes.map((c) => <option key={c} value={c}>{countryName(c)} ({c})</option>)}
              </select>
            </Field>
            <Field label={t("admin.holidays.subdivision")}>
              <select class="select" value={subdiv} onChange={(e) => setSubdiv(val(e))} disabled={subdivs.length === 0}>
                <option value="">{t("admin.holidays.national_only")}</option>
                {subdivs.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label={t("common.year")}><input class="input num" type="number" min={1990} max={2100} value={y} onInput={(e) => setY(Number(val(e)))} /></Field>
          </div>
        )}
        <Switch checked={halfDays} onChange={setHalfDays} label={t("admin.holidays.include_half_days")} />
        <Switch checked={replace} onChange={setReplace} label={t("admin.holidays.replace_year")} />
      </form>
    </Modal>
  );
}

function PresetModal({ onClose, onDone }: { onClose: () => void; onDone: (c: Calendar) => void }) {
  const presets = useAsync(() => api.get<{ key: string; name: string; description: string }[]>("/meta/holiday-presets"), []);
  const [key, setKey] = useState("");
  const [asDefault, setAsDefault] = useState(false);
  const { busy, run, error } = useAction();
  useEffect(() => { if (!key && presets.data?.length) setKey(presets.data[0].key); }, [presets.data]);
  async function install() {
    const r = await run(() => api.post<Calendar>(`/holiday-calendars/presets/${key}${asDefault ? "?default=1" : ""}`, {}), t("admin.holidays.preset_installed"));
    if (r) onDone(r);
  }
  return (
    <Modal title={t("admin.holidays.install_preset")} onClose={onClose} footer={<>
      <button class="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
      <button class="btn btn-primary" disabled={busy || !key} onClick={install}>{t("admin.holidays.install")}</button>
    </>}>
      <div class="stack">
        <p class="small muted">{t("admin.holidays.preset_help")}</p>
        <ErrorBox error={error} />
        {presets.loading ? <Loading /> : (presets.data || []).map((p) => (
          <label key={p.key} class={`mode-option ${key === p.key ? "active" : ""}`}>
            <input type="radio" name="preset" checked={key === p.key} onChange={() => setKey(p.key)} />
            <div><strong>{p.name}</strong><div class="small muted">{p.description}</div></div>
          </label>
        ))}
        <Switch checked={asDefault} onChange={setAsDefault} label={t("admin.holidays.use_as_default")} />
      </div>
    </Modal>
  );
}
