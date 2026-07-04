/**
 * Stable per-tab client id. Generated once per module load (i.e. per browser
 * tab / page session) and reused for the tab's lifetime. Sent as `X-Client-Id`
 * on mutations so the server can echo it back on SSE events, letting the origin
 * tab suppress its own broadcasts (it already applied the change optimistically).
 */
const CLIENT_ID: string =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `c_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

export function getClientId(): string {
  return CLIENT_ID;
}
