import { resolveApiOrigin } from './api-origin';
import { getClientId } from './clientId';
import type { UserActivityStats, HeatmapData } from './types';

const API_BASE = `${resolveApiOrigin()}/api/v1`;

type RequestOptions = {
  method?: string;
  body?: unknown;
  token?: string | null;
  isPublic?: boolean;
};

/// A failed API call.
///
/// The backend normalizes every `/api/v1` error into
/// `{ error: { code, message, remediation, status, caller_fault, docs_url } }`
/// (see `backend/src/middleware/error_envelope.rs`). `remediation` and
/// `callerFault` are carried through so UI and agent callers can distinguish
/// "fix the request" from "the server is broken" without parsing prose.
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public remediation?: string,
    public callerFault?: boolean,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token, isPublic = false } = opts;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // Per-tab id so the server can echo it on SSE events → origin tab suppresses
    // its own broadcast (already applied optimistically). See lib/clientId.ts.
    'X-Client-Id': getClientId(),
  };

  if (token && !isPublic) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // Handle 204 No Content
  if (res.status === 204) {
    return undefined as T;
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new ApiError(
      res.status,
      'HTML_RESPONSE',
      'Unexpected HTML response from API (likely wrong base URL or cached frontend bundle).',
    );
  }

  const text = await res.text();

  // Handle empty responses
  if (!text) {
    if (!res.ok) {
      throw new ApiError(res.status, 'UNKNOWN', `Request failed with status ${res.status}`);
    }
    return undefined as T;
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    const preview = text.replace(/\s+/g, ' ').slice(0, 120);
    throw new ApiError(
      res.status,
      'PARSE_ERROR',
      `Invalid JSON response from server (${res.status}) — preview: ${preview}`,
    );
  }

  if (!res.ok) {
    // Canonical shape (all routes, since the error_envelope layer):
    //   { "error": { code, message, remediation, status, caller_fault, docs_url } }
    // The plain-string branch is kept for older deployments and for any response
    // that bypasses the layer.
    const rawError = json.error;
    let code = 'UNKNOWN';
    let message = 'An error occurred';
    let remediation: string | undefined;
    let callerFault: boolean | undefined;
    if (typeof rawError === 'string') {
      message = rawError;
    } else if (rawError && typeof rawError === 'object') {
      const errorBody = rawError as Record<string, unknown>;
      if (typeof errorBody.code === 'string') code = errorBody.code;
      if (typeof errorBody.message === 'string') message = errorBody.message;
      if (typeof errorBody.remediation === 'string') remediation = errorBody.remediation;
      if (typeof errorBody.caller_fault === 'boolean') callerFault = errorBody.caller_fault;
    } else if (typeof json.message === 'string') {
      message = json.message;
    }
    throw new ApiError(res.status, code, message, remediation, callerFault);
  }

  return json.data as T;
}

export const api = {
  get: <T>(path: string, token?: string | null) =>
    request<T>(path, { token }),

  post: <T>(path: string, body: unknown, token?: string | null) =>
    request<T>(path, { method: 'POST', body, token }),

  patch: <T>(path: string, body: unknown, token?: string | null) =>
    request<T>(path, { method: 'PATCH', body, token }),

  put: <T>(path: string, body: unknown, token?: string | null) =>
    request<T>(path, { method: 'PUT', body, token }),

  delete: <T>(path: string, token?: string | null) =>
    request<T>(path, { method: 'DELETE', token }),

  // Gamification
  gamification: {
    me: (token: string) => request<UserActivityStats>('/gamification/me', { token }),
    heatmap: (token: string, days = 90) => request<HeatmapData>(`/gamification/heatmap?days=${days}`, { token }),
  },

  // Public endpoints (no auth token needed)
  public: {
    post: <T>(path: string, body: unknown) =>
      request<T>(path, { method: 'POST', body, isPublic: true }),

    get: <T>(path: string) =>
      request<T>(path, { isPublic: true }),
  },
};
