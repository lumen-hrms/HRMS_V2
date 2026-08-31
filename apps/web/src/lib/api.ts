/**
 * Thin fetch wrapper for the HRMS API.
 *
 * Tenant resolution in dev mode is header-based (TENANT_RESOLUTION_MODE=header
 * on the API), so every request carries X-Tenant-Subdomain. In production
 * this would come from the real subdomain and the header could be dropped.
 *
 * Access tokens live in memory only (never localStorage — XSS-exfiltrable
 * storage for a 15-minute token is an unnecessary risk); the refresh token
 * lives in an httpOnly cookie the browser sends automatically, so a page
 * reload silently re-authenticates via /auth/refresh.
 */

const API_BASE = '/api';

let accessToken: string | null = null;
let currentTenantSubdomain: string | null = localStorage.getItem('hrms.tenantSubdomain');

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export function setTenantSubdomain(subdomain: string) {
  currentTenantSubdomain = subdomain;
  localStorage.setItem('hrms.tenantSubdomain', subdomain);
}

export function getTenantSubdomain() {
  return currentTenantSubdomain;
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

async function request<T>(
  path: string,
  options: RequestInit & { skipAuthRetry?: boolean } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (currentTenantSubdomain) headers.set('X-Tenant-Subdomain', currentTenantSubdomain);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (res.status === 401 && !options.skipAuthRetry && path !== '/auth/refresh') {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return request<T>(path, { ...options, skipAuthRetry: true });
    }
  }

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new ApiError(res.status, body);
  }
  return body as T;
}

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: currentTenantSubdomain ? { 'X-Tenant-Subdomain': currentTenantSubdomain } : {},
    });
    if (!res.ok) return false;
    const body = await res.json();
    accessToken = body.accessToken;
    return true;
  } catch {
    return false;
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  refresh: tryRefresh,
};
