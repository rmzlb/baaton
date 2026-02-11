export function resolveApiOrigin(): string {
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
