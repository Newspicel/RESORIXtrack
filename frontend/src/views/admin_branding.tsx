// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { useRef, useState } from "preact/hooks";
import { Icon, Logo } from "../components/icons";
import { Confirm, ErrorBox, Field, Loading, useAction } from "../components/ui";
import { api } from "../lib/api";
import { applyAccent, branding, loadBranding } from "../lib/branding";
import { t } from "../lib/i18n";
import { me } from "../lib/store";
import { val } from "./admin_common";

const DEFAULT_ACCENT = "#35a1cc";

/** Administration → Settings → Branding: company name, accent colour, logos per theme. */
export function BrandingTab() {
  const b = branding.value;
  if (!b) {
    loadBranding().catch(() => {});
    return <Loading />;
  }
  return (
    <div class="stack lg">
      <CompanyAndAccent />
      <div class="card">
        <div class="card-head"><div><h2>{t("admin.branding.logos")}</h2><p class="card-sub">{t("admin.branding.logo_help")}</p></div></div>
        <div class="grid cols-2">
          <LogoCard variant="dark" />
          <LogoCard variant="light" />
        </div>
      </div>
    </div>
  );
}

function CompanyAndAccent() {
  const b = branding.value!;
  const [name, setName] = useState(me.value?.company_name || b.company_name);
  const [accent, setAccent] = useState(b.accent || "");
  const { busy, run, fieldErrors, error } = useAction();
  const changed = name.trim() !== b.company_name || (accent || "") !== (b.accent || "");
  async function save(e: Event) {
    e.preventDefault();
    const ok = await run(async () => {
      if (name.trim() !== b.company_name) {
        await api.patch("/admin/settings", { company_name: name.trim() });
        if (me.value) me.value = { ...me.value, company_name: name.trim() };
      }
      if ((accent || "") !== (b.accent || "")) await api.patch("/branding", { accent: accent || null });
      const fresh = await loadBranding(true);
      applyAccent(fresh.accent);
    }, t("admin.branding.saved"));
    if (!ok) return;
  }
  return (
    <form class="card" onSubmit={save}>
      <div class="card-head"><div><h2>{t("admin.branding.title")}</h2><p class="card-sub">{t("admin.branding.sub")}</p></div></div>
      <ErrorBox error={error} />
      <div class="form-grid">
        <Field label={t("admin.branding.company_name")} error={fieldErrors.company_name} help={t("admin.branding.company_help")}>
          <input class="input" required maxLength={120} value={name} onInput={(e) => setName(val(e))} />
        </Field>
        <Field label={t("admin.branding.accent")} help={t("admin.branding.accent_help")} error={fieldErrors.accent}>
          <div class="row">
            <input class="color-input" type="color" value={accent || DEFAULT_ACCENT} aria-label={t("admin.branding.accent")}
              onInput={(e) => setAccent(val(e).toLowerCase())} />
            <input class="input mono" style="max-width:130px" value={accent} placeholder={DEFAULT_ACCENT} pattern="#[0-9a-fA-F]{6}"
              onInput={(e) => setAccent(val(e).trim().toLowerCase())} aria-label={t("admin.branding.accent_hex")} />
            {accent && <button type="button" class="btn btn-ghost btn-sm" onClick={() => setAccent("")}>{t("admin.branding.use_default")}</button>}
          </div>
        </Field>
      </div>
      <div class="row end" style="padding-top:14px">
        <button class="btn btn-primary" disabled={busy || !changed}>{t("common.save")}</button>
      </div>
    </form>
  );
}

function LogoCard({ variant }: { variant: "dark" | "light" }) {
  const info = branding.value!.logos[variant];
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { busy, run, error } = useAction();
  async function pick(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = "";
    if (!file) return;
    await run(async () => {
      await api.upload(`/branding/logo/${variant}`, file);
      await loadBranding(true);
    }, t("admin.branding.uploaded"));
  }
  return (
    <div class="stack">
      <div class="row between">
        <strong>{t(`admin.branding.logo_${variant}`)}</strong>
        <span class={`badge ${info.custom ? "brand" : ""}`}>{info.custom ? t("admin.branding.custom") : t("admin.branding.default")}</span>
      </div>
      <div class={`logo-preview ${variant}`}>
        <Logo height={40} variant={variant} />
      </div>
      <ErrorBox error={error} />
      <div class="row wrap">
        <input ref={fileRef} type="file" accept=".svg,.png,image/svg+xml,image/png" class="sr-only" onChange={pick}
          aria-label={t(`admin.branding.logo_${variant}`)} />
        <button type="button" class="btn btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Icon.upload />{info.custom ? t("admin.branding.replace") : t("admin.branding.upload")}
        </button>
        {info.custom && (
          <button type="button" class="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirmRemove(true)}>
            <Icon.trash />{t("admin.branding.remove")}
          </button>
        )}
        <span class="tiny faint">{info.custom ? info.type.replace("image/", "").toUpperCase() : ""}</span>
      </div>
      {confirmRemove && (
        <Confirm title={t("admin.branding.remove_title")} message={t("admin.branding.remove_message")} confirmLabel={t("admin.branding.remove")}
          onClose={() => setConfirmRemove(false)}
          onConfirm={async () => {
            await run(async () => { await api.del(`/branding/logo/${variant}`); await loadBranding(true); }, t("admin.branding.removed"));
          }} />
      )}
    </div>
  );
}
