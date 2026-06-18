import { resolveApiOrigin } from './api-origin';
import type { UserActivityStats, HeatmapData } from './types';

const API_BASE = `${resolveApiOrigin()}/api/v1`;

type RequestOptions = {
  method?: string;
  body?: unknown;
  token?: string | null;
  isPublic?: boolean;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token, isPublic = false } = opts;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
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
    // Backend errors come in two shapes:
    //   { "error": "plain message" }              (most routes)
    //   { "error": { code, message } }            (structured)
    const rawError = json.error;
    let code = 'UNKNOWN';
    let message = 'An error occurred';
    if (typeof rawError === 'string') {
      message = rawError;
    } else if (rawError && typeof rawError === 'object') {
      const errorBody = rawError as Record<string, string>;
      code = errorBody.code || code;
      message = errorBody.message || message;
    } else if (typeof json.message === 'string') {
      message = json.message;
    }
    throw new ApiError(res.status, code, message);
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
