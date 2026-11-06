// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import type { ComponentChildren, JSX, VNode } from "preact";
import { cloneElement, toChildArray } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { ApiError } from "../lib/api";
import { t, tError } from "../lib/i18n";
import { toast, toasts } from "../lib/store";
import { fmtDuration } from "../lib/time";
import { Icon } from "./icons";

export function Spinner() {
  return <span class="spinner" role="status" aria-label={t("common.loading")} />;
}

export function Loading({ label }: { label?: string }) {
  return (
    <div class="loading">
      <Spinner /> {label || t("common.loading")}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ComponentChildren; title: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      {icon || <Icon.sparkle />}
      <div style="font-weight:600;color:var(--color-text)">{title}</div>
      {children && <div class="small" style="margin-top:4px">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div class="alert error" role="alert">{tError(error)}</div>;
}

export function Modal({ title, onClose, children, footer, wide }: {
  title: ComponentChildren; onClose: () => void; children: ComponentChildren; footer?: ComponentChildren; wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [titleId] = useState(() => `m${++fieldSeq}`);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(ref.current?.querySelectorAll<HTMLElement>(
      "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])") || []);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") { // keep focus inside the dialog
        const els = focusables();
        if (!els.length) return;
        const first = els[0], last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    const first = ref.current?.querySelector<HTMLElement>("input, select, textarea, button:not(.modal-x)");
    first?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      opener?.focus?.(); // return focus to the element that opened the dialog
    };
  }, []);
  return (
    <div class="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div class="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button class="btn btn-ghost btn-icon btn-sm modal-x" onClick={onClose} aria-label={t("common.close")}><Icon.x /></button>
        </div>
        <div class="modal-body">{children}</div>
        {footer && <div class="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

let fieldSeq = 0;

/** Label + control + help/error. The label is associated with the first form control inside
 *  (an id is generated when the control has none), so screen readers and clicking the label work. */
export function Field({ label, help, error, children, class: cls, htmlFor }: {
  label?: ComponentChildren; help?: ComponentChildren; error?: string | null; children: ComponentChildren; class?: string; htmlFor?: string;
}) {
  const [autoId] = useState(() => `f${++fieldSeq}`);
  let id = htmlFor;
  let content: ComponentChildren = children;
  if (!id) {
    const kids = toChildArray(children);
    const first = kids.find((k) => k && typeof k === "object" && "type" in (k as VNode) && ["input", "select", "textarea"].includes(String((k as VNode).type))) as VNode | undefined;
    if (first) {
      id = (first.props as any).id || autoId;
      if (!(first.props as any).id) content = kids.map((k) => (k === first ? cloneElement(first, { id }) : k));
    }
  }
  const describedBy = error || help ? `${id || autoId}-help` : undefined;
  return (
    <div class={`field ${cls || ""}`}>
      {label && <label for={id}>{label}</label>}
      {content}
      {error ? <div class="error" id={describedBy} role="alert">{error}</div> : help ? <div class="help" id={describedBy}>{help}</div> : null}
    </div>
  );
}

export function Toasts() {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.value.map((x) => <div key={x.id} class={`toast ${x.kind}`}>{x.text}</div>)}
    </div>
  );
}

export function Duration({ min, signed, class: cls }: { min: number | null | undefined; signed?: boolean; class?: string }) {
  const tone = signed && min !== null && min !== undefined ? (min > 0.5 ? "pos" : min < -0.5 ? "neg" : "") : "";
  return <span class={`num ${tone} ${cls || ""}`}>{fmtDuration(min, { signed })}</span>;
}

export function Avatar({ name, size }: { name: string; size?: "sm" }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
  return <span class={`avatar ${size || ""}`} aria-hidden="true">{initials}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const cls = { approved: "ok", pending: "warn", rejected: "danger", cancelled: "" }[status] ?? "";
  return <span class={`badge ${cls}`}>{t(`absences.status.${status}`)}</span>;
}

export function Segmented<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: ComponentChildren }[]; onChange: (v: T) => void;
}) {
  return (
    <div class="segmented" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} class={o.value === value ? "active" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { value: T; label: ComponentChildren }[]; onChange: (v: T) => void }) {
  return (
    <div class="tabs" role="tablist">
      {tabs.map((x) => (
        <button key={x.value} role="tab" aria-selected={x.value === value} class={x.value === value ? "active" : ""} onClick={() => onChange(x.value)}>{x.label}</button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ComponentChildren; disabled?: boolean }) {
  return (
    <label class="switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
      {label && <span>{label}</span>}
    </label>
  );
}

/** useAsync: load data with loading/error state; reload on deps change. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn().then(
      (d) => alive && (setData(d), setError(null)),
      (e) => alive && setError(e),
    ).finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((x) => x + 1), setData };
}

/** Wrap an async action: busy flag + error toast + field errors. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  async function run<T>(fn: () => Promise<T>, okMessage?: string): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const r = await fn();
      if (okMessage) toast(okMessage, "ok");
      // Success is signalled by a defined value, even for actions that return nothing.
      return (r === undefined ? true : r) as T;
    } catch (e) {
      setError(e);
      if (e instanceof ApiError) {
        const fe: Record<string, string> = {};
        for (const [k, v] of Object.entries(e.fields || {})) fe[k] = typeof v === "string" ? fieldMessage(k, v) : tError(e);
        setFieldErrors(fe);
      }
      toast(tError(e), "error", 6000);
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, run, fieldErrors, error, setFieldErrors };
}

function fieldMessage(field: string, code: string): string {
  const key = `errors.fields.${code}`;
  const msg = t(key);
  return msg === key ? code : msg;
}

export function Confirm({ title, message, confirmLabel, cancelLabel, danger, requireReason, reasonLabel, onConfirm, onClose }: {
  title: string; message?: ComponentChildren; confirmLabel?: string; cancelLabel?: string; danger?: boolean; requireReason?: boolean; reasonLabel?: string;
  onConfirm: (reason: string) => Promise<unknown> | void; onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button class="btn btn-ghost" onClick={onClose}>{cancelLabel || t("common.cancel")}</button>
      <button class={`btn ${danger ? "btn-danger" : "btn-primary"}`} disabled={busy || (requireReason && !reason.trim())}
        onClick={async () => { setBusy(true); try { await onConfirm(reason); onClose(); } finally { setBusy(false); } }}>
        {confirmLabel || t("common.confirm")}
      </button>
    </>}>
      <div class="stack">
        {message && <div class="muted">{message}</div>}
        {requireReason !== undefined && (
          <Field label={<span class="row" style="gap:8px">{reasonLabel || t("common.reason")}{requireReason
            ? <span class="badge danger">{t("common.required")}</span> : <span class="faint">({t("common.optional")})</span>}</span>}
            help={requireReason ? t("common.reason_required_help") : undefined}>
            <textarea class="textarea" value={reason} onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

/** Confirmation for sensitive actions: the person re-enters their own password. */
export function PasswordConfirmModal({ title, message, confirmLabel, danger, onConfirm, onClose }: {
  title: string; message?: ComponentChildren; confirmLabel?: string; danger?: boolean;
  onConfirm: (password: string) => Promise<unknown>; onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const { busy, run, fieldErrors } = useAction();
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button class="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
      <button class={`btn ${danger ? "btn-danger" : "btn-primary"}`} form="pw-confirm" disabled={busy || !password}>{confirmLabel || t("common.confirm")}</button>
    </>}>
      <form id="pw-confirm" class="stack" onSubmit={async (e) => { e.preventDefault(); if (await run(() => onConfirm(password))) onClose(); }}>
        {message && <div class="muted">{message}</div>}
        <Field label={t("common.your_password")} help={t("common.your_password_help")} error={fieldErrors.admin_password || fieldErrors.current_password}>
          <input class="input" type="password" autocomplete="current-password" required value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
        </Field>
      </form>
    </Modal>
  );
}

export function Input(p: JSX.HTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const { invalid, ...rest } = p;
  return <input class="input" aria-invalid={invalid ? "true" : undefined} {...rest} />;
}

export function PageHead({ title, sub, actions }: { title: ComponentChildren; sub?: ComponentChildren; actions?: ComponentChildren }) {
  return (
    <div class="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p class="muted">{sub}</p>}
      </div>
      {actions && <div class="row wrap">{actions}</div>}
    </div>
  );
}
