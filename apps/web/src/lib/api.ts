/**
 * Thin fetch wrapper for the HRMS API.
 *
 * Tenant resolution in dev mode is header-based (TENANT_RESOLUTION_MODE=header
 * on the API), so every request carries X-Tenant-Subdomain. In production
 * this would come from the real subdomain and the header could be dropped.
 *
 * Auth is Firebase now: every request attaches the current Firebase user's
 * ID token as `Authorization: Bearer <token>`. The Firebase Web SDK
 * refreshes that token silently in the background (onIdTokenChanged in
 * auth-context.tsx) — there's no app-level refresh-cookie/retry dance to
 * do here anymore.
 */
import { auth } from './firebase';

const API_BASE = '/api';

let currentTenantSubdomain: string | null = localStorage.getItem('hrms.tenantSubdomain');

export function setTenantSubdomain(subdomain: string) {
  currentTenantSubdomain = subdomain;
  localStorage.setItem('hrms.tenantSubdomain', subdomain);
}

export function getTenantSubdomain() {
  return currentTenantSubdomain;
}

/** For the rare call site that needs to build a raw `fetch` itself (e.g.
 * multipart file upload) instead of going through `api.*`. */
export function getAccessToken() {
  return auth.currentUser?.getIdToken() ?? Promise.resolve(null);
}

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any) {
    super(body?.message ?? `Request failed with status ${status}`);
    this.status = status;
    this.body = body;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  // FormData sets its own multipart Content-Type (with the boundary).
  if (!(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (currentTenantSubdomain) headers.set('X-Tenant-Subdomain', currentTenantSubdomain);

  const idToken = await auth.currentUser?.getIdToken();
  if (idToken) headers.set('Authorization', `Bearer ${idToken}`);

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new ApiError(res.status, body);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined }),
  /** Multipart upload of one file under the `file` field (every upload route uses that name). */
  upload: <T>(path: string, file: File) => {
    const body = new FormData();
    body.append('file', file);
    return request<T>(path, { method: 'POST', body });
  },
};
