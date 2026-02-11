function resolveApiOrigin(): string {
  const configured = (import.meta.env.VITE_API_URL || '').trim();
  if (configured) return configured.replace(/\/$/, '');

  if (typeof window !== 'undefined') {
    const { hostname, origin } = window.location;
    const isBaatonProdHost =
      hostname === 'baaton.dev'
      || hostname === 'www.baaton.dev'
      || hostname === 'app.baaton.dev'
      || hostname.endsWith('.baaton.dev');

    if (isBaatonProdHost) {
      return 'https://api.baaton.dev';
    }
    return origin;
  }

  return '';
}

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
    const errorBody = json.error as Record<string, string> | undefined;
    throw new ApiError(
      res.status,
      errorBody?.code || 'UNKNOWN',
      errorBody?.message || 'An error occurred',
    );
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

  // Public endpoints (no auth token needed)
  public: {
    post: <T>(path: string, body: unknown) =>
      request<T>(path, { method: 'POST', body, isPublic: true }),

    get: <T>(path: string) =>
      request<T>(path, { isPublic: true }),
  },
};
