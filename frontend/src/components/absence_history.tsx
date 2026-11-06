// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { absenceRange } from "../lib/absence";
import { api } from "../lib/api";
import { fieldLabel, fmtFieldValue } from "../lib/audit";
import { absenceLabel, t } from "../lib/i18n";
import { ErrorBox, Loading, Modal, useAsync } from "./ui";

const PIN_CLASS: Record<string, string> = { cancel: "pin del", reject: "pin del", approve: "pin", create: "pin", update: "pin other" };

/** Change history of one absence: who requested, decided, changed or cancelled it, and why. */
export function AbsenceHistoryModal({ absence, tz, onClose }: { absence: any; tz: string; onClose: () => void }) {
  const { data, loading, error } = useAsync(() => api.get<any[]>(`/absences/${absence.id}/history`), [absence.id]);
  return (
    <Modal title={t("absences.history_title")} onClose={onClose}>
      <div class="stack">
        <div class="muted small">{absence.user?.name && `${absence.user.name} · `}{absenceLabel(absence.type)} · {absenceRange(absence)}</div>
        <ErrorBox error={error} />
        {loading ? <Loading /> : (data || []).length === 0 ? <p class="muted small">{t("absences.history_empty")}</p> : (
          <ul class="history">
            {(data || []).map((r) => (
              <li key={r.id}>
                <span class={PIN_CLASS[r.action] || "pin"} />
                <div class="row wrap" style="gap:8px">
                  <strong>{t(`absences.action.${r.action}`) !== `absences.action.${r.action}` ? t(`absences.action.${r.action}`) : r.action}</strong>
                  <span class="muted small">{r.actor?.name || t("common.unknown")} · {fmtDateTime(r.at, tz)}</span>
                </div>
                {r.action === "update" && r.before && r.after && (
                  <div class="small diff">{(r.changed || []).filter((k: string) => ["start_date", "end_date", "start_half", "end_half", "note"].includes(k)).map((k: string) => (
                    <span key={k}><span class="muted">{fieldLabel("absence", k)}</span> <del>{fmtFieldValue(k, r.before[k], tz)}</del> → <ins>{fmtFieldValue(k, r.after[k], tz)}</ins></span>
                  ))}</div>
                )}
                {r.reason && <div class="small">“{r.reason}”</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

import { fmtDateTime } from "../lib/time";
