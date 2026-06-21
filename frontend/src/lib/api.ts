// Lightweight fetch wrapper. Client-side only usage is expected.
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

const TOKEN_KEY = 'erpgrip_token';
const COMPANY_KEY = 'erpgrip.activeCompany';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
}

// The active company is attached to every request as `X-Company-Id`, so the
// backend scopes all cpanel data (objects, menus, groups, dashboards) to it.
export function getCompanyId(): number | null {
  if (typeof window === 'undefined') return null;
  const n = Number(window.localStorage.getItem(COMPANY_KEY));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function setCompanyId(id: number | null) {
  if (typeof window === 'undefined') return;
  if (id == null) window.localStorage.removeItem(COMPANY_KEY);
  else window.localStorage.setItem(COMPANY_KEY, String(id));
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  // when true, a 401 will NOT trigger the global redirect (used by /auth/me bootstrap)
  silent401?: boolean;
}

function handleUnauthorized() {
  clearToken();
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { body, silent401, headers, ...rest } = options;
  const token = getToken();
  const companyId = getCompanyId();

  const finalHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...(headers as Record<string, string>),
  };
  if (body !== undefined && !(body instanceof FormData)) {
    finalHeaders['Content-Type'] = 'application/json';
  }
  if (token) {
    finalHeaders['Authorization'] = `Bearer ${token}`;
  }
  if (companyId) {
    finalHeaders['X-Company-Id'] = String(companyId);
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...rest,
      headers: finalHeaders,
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError(
      'Network error: could not reach the API server.',
      0,
      null,
    );
  }

  if (res.status === 401) {
    if (!silent401) handleUnauthorized();
    throw new ApiError('Unauthorized', 401, null);
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const message =
      (data &&
        typeof data === 'object' &&
        'message' in data &&
        (Array.isArray((data as any).message)
          ? (data as any).message.join(', ')
          : String((data as any).message))) ||
      `Request failed (${res.status})`;
    throw new ApiError(message, res.status, data);
  }

  return data as T;
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) =>
    apiFetch<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    apiFetch<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    apiFetch<T>(path, { ...opts, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    apiFetch<T>(path, { ...opts, method: 'PUT', body }),
  delete: <T>(path: string, opts?: RequestOptions) =>
    apiFetch<T>(path, { ...opts, method: 'DELETE' }),
};
