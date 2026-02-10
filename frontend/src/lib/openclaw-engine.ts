/**
 * OpenClaw Chat Engine — connects to user's OpenClaw gateway for AI responses.
 * Per-user connection (NOT per-org) stored in localStorage.
 *
 * Best practices:
 * - Session isolation via `baaton:user:<clerk_user_id>` session keys
 * - Uses `sessions_send` pattern for sending messages
 * - Graceful error handling with typed errors
 * - Connection testing via `/api/status`
 */

const STORAGE_KEY = 'baaton-openclaw-connection';

export interface OpenClawConfig {
  name: string;
  gatewayUrl: string;
  apiToken: string;
  agentId?: string;
  status: 'pending' | 'connected' | 'error';
  lastPingAt?: string;
}

export interface OpenClawResponse {
  text: string;
}

export class OpenClawError extends Error {
  statusCode?: number;
  isConnectionError: boolean;

  constructor(
    message: string,
    statusCode?: number,
    isConnectionError = false,
  ) {
    super(message);
    this.name = 'OpenClawError';
    this.statusCode = statusCode;
    this.isConnectionError = isConnectionError;
  }
}

// ─── Config Management (localStorage) ─────────

export function saveOpenClawConfig(config: OpenClawConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    console.warn('[OpenClaw] Failed to save config to localStorage');
  }
}

export function getOpenClawConfig(): OpenClawConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Migration: support old `apiUrl` field -> `gatewayUrl`
    if (parsed.apiUrl && !parsed.gatewayUrl) {
      parsed.gatewayUrl = parsed.apiUrl;
      delete parsed.apiUrl;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    }
    return parsed as OpenClawConfig;
  } catch {
    return null;
  }
}

export function clearOpenClawConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function isOpenClawConnected(): boolean {
  const config = getOpenClawConfig();
  return config?.status === 'connected';
}

// ─── API Helpers ──────────────────────────────

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function buildHeaders(apiToken: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${apiToken}`,
    'Content-Type': 'application/json',
  };
}

// ─── Test Connection ──────────────────────────

export async function testOpenClawConnection(
  config: Pick<OpenClawConfig, 'gatewayUrl' | 'apiToken'>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const baseUrl = normalizeUrl(config.gatewayUrl);
    const res = await fetch(`${baseUrl}/api/status`, {
      method: 'GET',
      headers: buildHeaders(config.apiToken),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${res.statusText}` };
    }

    const data = await res.json().catch(() => null);
    if (data && typeof data === 'object') {
      return { ok: true };
    }
    return { ok: false, error: 'Unexpected response format' };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, error: 'Connection timed out (8s)' };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Connection failed',
    };
  }
}

// ─── Send Message ─────────────────────────────

/**
 * Send a message to OpenClaw gateway using the sessions_send pattern.
 * Each Baaton user gets an isolated session via `baaton:user:<userId>`.
 */
export async function sendToOpenClaw(
  message: string,
  config: OpenClawConfig,
  options?: {
    userId?: string;
    context?: string;
    timeoutMs?: number;
  },
): Promise<OpenClawResponse> {
  const baseUrl = normalizeUrl(config.gatewayUrl);
  const timeout = options?.timeoutMs ?? 30000;

  // Build the full message with optional context
  const fullMessage = options?.context
    ? `${message}\n\n---\n${options.context}`
    : message;

  // Build request body following OpenClaw sessions_send pattern
  const body: Record<string, unknown> = {
    message: fullMessage,
  };

  // Session isolation: use a per-user session key
  if (options?.userId) {
    body.session = `baaton:user:${options.userId}`;
  }

  // Target a specific agent if configured
  if (config.agentId) {
    body.agent = config.agentId;
  }

  try {
    const res = await fetch(`${baseUrl}/api/sessions/send`, {
      method: 'POST',
      headers: buildHeaders(config.apiToken),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new OpenClawError(
        `Gateway returned ${res.status}: ${errorText || res.statusText}`,
        res.status,
      );
    }

    const data = await res.json();

    // OpenClaw can return response in different fields
    const text = data.response || data.content || data.text || data.message;
    if (!text) {
      throw new OpenClawError('Empty response from gateway');
    }

    return { text };
  } catch (err) {
    if (err instanceof OpenClawError) throw err;

    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new OpenClawError('Request timed out', undefined, true);
    }

    throw new OpenClawError(
      err instanceof Error ? err.message : 'Connection failed',
      undefined,
      true,
    );
  }
}
