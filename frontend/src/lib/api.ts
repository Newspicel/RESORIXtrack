// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
/** Thin JSON client for the RESORIXtrack REST API (cookie session + CSRF header). */

export class ApiError extends Error {
  status: number;
  code: string;
  fields: Record<string, unknown>;
  constructor(status: number, code: string, message: string, fields: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/[.$?*|{}()[\]\\/+^]/g, "\\$&") + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

const PUBLIC_PAGES = ["/login", "/forgot", "/reset", "/invite", "/setup"];

export function redirectToLogin() {
  const here = location.pathname + location.search;
  if (PUBLIC_PAGES.some((p) => location.pathname.startsWith(p))) return;
  location.href = "/login?next=" + encodeURIComponent(here);
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function qs(params: Query = {}): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? "?" + s : "";
}

export async function request<T = any>(method: string, path: string, body?: unknown, opts: { raw?: boolean; noRedirect?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  if (method !== "GET") {
    // __Host- prefix when served over HTTPS (see backend config), plain name on http://localhost
    const csrf = readCookie("__Host-rt_csrf") || readCookie("rt_csrf");
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }
  let res: Response;
  try {
    res = await fetch("/api/v1" + path, { method, headers, body: payload, credentials: "same-origin" });
  } catch (e) {
    throw new ApiError(0, "network", "network_error");
  }
  if (opts.raw && res.ok) return res as unknown as T;
  const isJson = (res.headers.get("Content-Type") || "").includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    if (res.status === 401 && !opts.noRedirect) redirectToLogin();
    const err = data?.error || {};
    throw new ApiError(res.status, err.code || "http_" + res.status, err.message || res.statusText, err.fields || {});
  }
  return data as T;
}

export const api = {
  get: <T = any>(path: string, params?: Query, opts?: { noRedirect?: boolean }) => request<T>("GET", path + qs(params), undefined, opts),
  post: <T = any>(path: string, body: unknown = {}, opts?: { noRedirect?: boolean }) => request<T>("POST", path, body, opts),
  patch: <T = any>(path: string, body: unknown = {}) => request<T>("PATCH", path, body),
  put: <T = any>(path: string, body: unknown = {}) => request<T>("PUT", path, body),
  del: <T = any>(path: string, body?: unknown) => request<T>("DELETE", path, body),
  upload: <T = any>(path: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<T>("POST", path, fd);
  },
};

/** Download a file endpoint (PDF/XLSX/CSV/ZIP) using the session cookie. */
export async function download(path: string, params?: Query, fallbackName = "download", method: "GET" | "POST" = "GET") {
  const res = await request<Response>(method, path + qs(params), method === "POST" ? {} : undefined, { raw: true });
  const cd = res.headers.get("Content-Disposition") || "";
  const m = cd.match(/filename="?([^";]+)"?/);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = m ? m[1] : fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
