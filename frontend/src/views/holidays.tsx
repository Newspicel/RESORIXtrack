// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { useState } from "preact/hooks";
import { Icon } from "../components/icons";
import { Shell } from "../components/Shell";
import { Empty, ErrorBox, Loading, PageHead, useAsync } from "../components/ui";
import { api } from "../lib/api";
import { holidayName, t } from "../lib/i18n";
import { me, tz } from "../lib/store";
import { fmtDate, todayIn, weekday, weekdayName } from "../lib/time";

interface Holiday { id: number; date: string; name: string; fraction: number }
interface MyCalendar {
  id: number; name: string; region_code: string; description: string; is_default: boolean;
  years: number[]; holidays: Holiday[]; source: "user" | "team" | "default";
}

/** The public holidays that apply to the signed-in person: read-only, resolved by the server
 * (personal assignment -> team calendar -> company default). */
export function HolidaysPage() {
  const admin = !!me.value?.permissions.admin;
  return (
    <Shell active="holidays" title={t("nav.holidays")}>
      <PageHead title={t("public_holidays.title")} sub={t("public_holidays.sub")}
        actions={admin ? <a class="btn" href="/admin/holidays"><Icon.settings />{t("public_holidays.manage")}</a> : undefined} />
      <MyHolidays />
    </Shell>
  );
}

function MyHolidays() {
  const thisYear = Number(todayIn(tz()).slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const cal = useAsync(() => api.get<MyCalendar | null>("/holiday-calendars/mine"), []);
  if (cal.error) return <ErrorBox error={cal.error} />;
  if (cal.loading) return <Loading />;
  const data = cal.data;
  if (!data) {
    return <div class="card"><Empty icon={<Icon.flag />} title={t("public_holidays.none")}>{t("public_holidays.none_help")}</Empty></div>;
  }
  const years = [...new Set([...data.years, thisYear, thisYear + 1])].sort();
  const holidays = data.holidays.filter((h) => h.date.startsWith(`${year}-`));
  const teamName = me.value?.user.team_name;
  const source = data.source === "user" ? t("public_holidays.source_user")
    : data.source === "team" ? `${t("public_holidays.source_team")}${teamName ? ` (${teamName})` : ""}`
    : t("public_holidays.source_default");
  return (
    <div class="card stack lg">
      <div class="row between wrap">
        <div>
          <h2 class="row">{data.name}<span class="badge brand">{source}</span></h2>
          <div class="small muted" style="margin-top:4px">{[data.region_code, data.description].filter(Boolean).join(" · ")}</div>
        </div>
        <div class="segmented" role="tablist">
          {years.map((y) => <button key={y} class={y === year ? "active" : ""} onClick={() => setYear(y)}>{y}</button>)}
        </div>
      </div>
      {holidays.length === 0 ? (
        <Empty icon={<Icon.flag />} title={t("admin.holidays.none_in_year", { year })} />
      ) : (
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>{t("common.date")}</th><th>{t("common.name")}</th><th class="hide-mobile">{t("admin.holidays.duration")}</th></tr></thead>
            <tbody>
              {holidays.map((h) => {
                const wd = weekday(h.date);
                return (
                  <tr key={h.id} class={wd >= 5 ? "weekend" : ""}>
                    <td class="nowrap"><span class="muted" style="display:inline-block;width:32px">{weekdayName(wd)}</span>{fmtDate(h.date, { day: "numeric", month: "long" })}</td>
                    <td title={h.name}>{holidayName(h.name)}{h.fraction < 1 && <span class="badge warn only-mobile" style="margin-left:6px">½</span>}{wd >= 5 && <div class="tiny faint">{t("admin.holidays.on_weekend")}</div>}</td>
                    <td class="hide-mobile">{h.fraction < 1 ? <span class="badge warn">{t("admin.holidays.half_day")}</span> : <span class="badge">{t("admin.holidays.full_day")}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p class="tiny muted">{t("public_holidays.help")}</p>
    </div>
  );
}
