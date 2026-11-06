// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { useState } from "preact/hooks";
import { Icon } from "../components/icons";
import { useAsync } from "../components/ui";
import { api } from "../lib/api";
import { t } from "../lib/i18n";

interface Step { done: boolean; href: string; optional?: boolean; count?: number }
interface Checklist { dismissed: boolean; steps: Record<string, Step> }

const ORDER = ["rules", "email", "holidays", "teams", "employees", "branding", "backups"];

/** Setup checklist for administrators, shown on the dashboard until dismissed. */
export function GettingStarted() {
  const { data, setData } = useAsync(() => api.get<Checklist>("/admin/getting-started"), []);
  const [hidden, setHidden] = useState(false);
  if (!data || data.dismissed || hidden) return null;
  const steps = ORDER.filter((k) => data.steps[k]).map((k) => ({ key: k, ...data.steps[k] }));
  const required = steps.filter((s) => !s.optional);
  const done = required.filter((s) => s.done).length;
  async function dismiss() {
    setHidden(true);
    try {
      await api.post("/admin/getting-started/dismiss");
      setData({ ...data!, dismissed: true });
    } catch { /* shown again next time */ }
  }
  return (
    <div class="card getting-started">
      <div class="card-head">
        <div>
          <h2><Icon.sparkle />{t("dashboard.setup.title")}</h2>
          <p class="card-sub">{t("dashboard.setup.sub", { done, total: required.length })}</p>
        </div>
        <button class="btn btn-ghost btn-sm" onClick={dismiss}>{done === required.length ? t("dashboard.setup.done_button") : t("dashboard.setup.hide")}</button>
      </div>
      <div class="progress" style="margin-bottom:14px"><span style={{ width: `${required.length ? (done / required.length) * 100 : 0}%` }} /></div>
      <ol class="setup-steps">
        {steps.map((s) => (
          <li key={s.key} class={s.done ? "done" : ""}>
            <span class="mark" aria-hidden="true">{s.done ? <Icon.check /> : null}</span>
            <div class="grow">
              <a href={s.href}>{t(`dashboard.setup.${s.key}`)}</a>
              {s.optional && <span class="tiny faint"> · {t("common.optional")}</span>}
              <div class="small muted">{t(`dashboard.setup.${s.key}_help`)}</div>
            </div>
            {!s.done && <a class="btn btn-sm" href={s.href}>{t("dashboard.setup.go")}</a>}
          </li>
        ))}
      </ol>
      <p class="tiny muted" style="margin-top:12px">{t("dashboard.setup.docs_hint")}</p>
    </div>
  );
}
