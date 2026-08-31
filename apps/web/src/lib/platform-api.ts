/** Separate, tiny client for the platform-admin console. Deliberately does
 * NOT share state with lib/api.ts — a platform admin token and a tenant
 * user token are different token types that must never be conflated. */

let platformToken: string | null = null;

export function setPlatformToken(token: string | null) {
  platformToken = token;
}

export class PlatformApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any) {
    super(body?.message ?? `Request failed with status ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (platformToken) headers.set('Authorization', `Bearer ${platformToken}`);
  const res = await fetch(`/api/platform-admin${path}`, { ...options, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new PlatformApiError(res.status, body);
  return body as T;
}

export const platformApi = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
};
