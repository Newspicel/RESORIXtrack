// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import "../styles/admin.css";
import { useState } from "preact/hooks";
import { Icon } from "../components/icons";
import { Shell } from "../components/Shell";
import { Empty, ErrorBox, Field, Loading, Modal, PageHead, Switch, useAction } from "../components/ui";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { me } from "../lib/store";
import { TeamSelect, type Team } from "../components/schedule_panel";
import { safely, val } from "./admin_common";
import { rankItems } from "../lib/people";
import { invalidateProjects, useProjects, type Project } from "./worklog";

export function ProjectsPage() {
  return (
    <Shell active="projects" managerOnly title={t("worklog.projects")}>
      <ProjectsView />
    </Shell>
  );
}

function ProjectsView() {
  const [showInactive, setShowInactive] = useState(false);
  const [q, setQ] = useState("");
  const [teamFilter, setTeamFilter] = useState<number | null>(null);
  const projects = useProjects(true);
  const [edit, setEdit] = useState<Project | "new" | null>(null);
  const all = projects.data || [];
  const rows = rankItems(all.filter((p) => (showInactive || p.is_active) && (teamFilter === null || p.team_id === teamFilter)), q,
    (p) => ({ name: p.name, extra: `${p.code} ${p.team_name || ""}` }));
  const m = me.value!;
  async function toggle(p: Project, active: boolean) {
    if (await safely(() => api.patch(`/projects/${p.id}`, { is_active: active }), t("common.saved"))) { invalidateProjects(); projects.reload(); }
  }
  const canManage = (p: Project) => m.permissions.projects || (p.team_id !== null && (m.user.led_team_ids || []).includes(p.team_id));
  return (
    <div>
      <PageHead title={t("worklog.projects")} sub={t("worklog.projects_sub")}
        actions={<button class="btn btn-primary" onClick={() => setEdit("new")}><Icon.plus />{t("worklog.new_project")}</button>} />
      <div class="card">
        <div class="row wrap" style="margin-bottom:14px;gap:10px">
          <input class="input" type="search" style="flex:1 1 220px;max-width:360px" placeholder={t("worklog.search_projects")} value={q} onInput={(e) => setQ(val(e))} aria-label={t("common.search")} />
          <TeamSelect value={teamFilter} onChange={setTeamFilter} emptyLabel={t("team.all_teams")} style="width:auto;min-width:160px" />
          <Switch checked={showInactive} onChange={setShowInactive} label={t("worklog.show_inactive")} />
          <span class="small muted" style="margin-left:auto">{rows.length === all.length ? t("worklog.n_projects", { count: rows.length }) : t("worklog.n_of_projects", { count: rows.length, total: all.length })}</span>
        </div>
        <ErrorBox error={projects.error} />
        {projects.loading && !projects.data ? <Loading /> : rows.length === 0 ? (
          <Empty icon={<Icon.file />} title={t("worklog.no_projects")}>{t("worklog.no_projects_help")}</Empty>
        ) : (
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>{t("worklog.project")}</th><th>{t("worklog.code")}</th><th>{t("common.team")}</th><th class="hide-mobile">{t("worklog.description")}</th><th>{t("common.status")}</th><th /></tr></thead>
              <tbody>{rows.map((p) => (
                <tr key={p.id} style={p.is_active ? "" : "opacity:.6"}>
                  <td><span class="row" style="gap:8px"><span class="dot" style={{ background: p.color }} /><strong>{p.name}</strong></span></td>
                  <td class="mono small">{p.code || <span class="faint">–</span>}</td>
                  <td>{p.team_name || <span class="badge">{t("worklog.company_wide")}</span>}</td>
                  <td class="hide-mobile small muted">{p.description}</td>
                  <td>{canManage(p) ? <Switch checked={p.is_active} onChange={(v) => toggle(p, v)} label={p.is_active ? t("common.active") : t("common.inactive")} />
                    : <span class={`badge ${p.is_active ? "ok" : ""}`}>{p.is_active ? t("common.active") : t("common.inactive")}</span>}</td>
                  <td class="n">{canManage(p) && <button class="btn btn-ghost btn-sm btn-icon" aria-label={t("common.edit")} onClick={() => setEdit(p)}><Icon.edit /></button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
      {edit && <ProjectModal project={edit === "new" ? null : edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); invalidateProjects(); projects.reload(); }} />}
    </div>
  );
}

function ProjectModal({ project, onClose, onDone }: { project: Project | null; onClose: () => void; onDone: () => void }) {
  const m = me.value!;
  const ledTeams = m.user.led_team_ids || [];
  const [f, setF] = useState({
    name: project?.name || "", code: project?.code || "", color: project?.color || "#35a1cc", description: (project as any)?.description || "",
    team_id: project ? project.team_id : (m.permissions.projects ? null : ledTeams[0] ?? null), is_active: project?.is_active ?? true,
  });
  const { busy, run, fieldErrors, error } = useAction();
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  async function save(e: Event) {
    e.preventDefault();
    const r = await run(() => (project ? api.patch(`/projects/${project.id}`, f) : api.post("/projects", f)), t("common.saved"));
    if (r) onDone();
  }
  const teamFilter = (teams: Team[]) => (m.permissions.projects ? teams : teams.filter((tm) => ledTeams.includes(tm.id)));
  return (
    <Modal title={project ? t("worklog.edit_project") : t("worklog.new_project")} onClose={onClose} footer={<>
      <button class="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
      <button class="btn btn-primary" form="project-form" disabled={busy}>{t("common.save")}</button>
    </>}>
      <form id="project-form" class="stack" onSubmit={save}>
        <ErrorBox error={error} />
        <div class="form-grid">
          <Field label={t("worklog.project")} error={fieldErrors.name}><input class="input" required maxLength={120} value={f.name} onInput={(e) => set({ name: val(e) })} /></Field>
          <Field label={t("worklog.code")} help={t("worklog.code_help")} error={fieldErrors.code}><input class="input mono" maxLength={30} value={f.code} onInput={(e) => set({ code: val(e) })} /></Field>
          <Field label={t("common.team")} help={m.permissions.projects ? t("worklog.team_help_admin") : t("worklog.team_help_lead")}>
            <TeamSelectFiltered value={f.team_id} onChange={(v) => set({ team_id: v })} filter={teamFilter} allowCompanyWide={m.permissions.projects} />
          </Field>
          <Field label={t("admin.teams.color")}><input class="color-input" type="color" value={f.color} onInput={(e) => set({ color: val(e) })} /></Field>
        </div>
        <Field label={t("worklog.description")}><input class="input" maxLength={500} value={f.description} onInput={(e) => set({ description: val(e) })} /></Field>
        <Switch checked={f.is_active} onChange={(v) => set({ is_active: v })} label={t("worklog.active_help")} />
      </form>
    </Modal>
  );
}

function TeamSelectFiltered({ value, onChange, filter, allowCompanyWide }: {
  value: number | null; onChange: (v: number | null) => void; filter: (teams: Team[]) => Team[]; allowCompanyWide: boolean;
}) {
  const [teams, setTeams] = useState<Team[] | null>(null);
  if (teams === null) api.get<Team[]>("/teams").then((l) => setTeams(filter(l))).catch(() => setTeams([]));
  const list = teams || [];
  return (
    <select class="select" value={value ?? ""} onChange={(e) => onChange(val(e) ? Number(val(e)) : null)} aria-label={t("common.team")}>
      {allowCompanyWide && <option value="">{t("worklog.company_wide")}</option>}
      {list.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
    </select>
  );
}

