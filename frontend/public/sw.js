const CACHE_NAME = 'baaton-v2';

// Install: skip waiting immediately
self.addEventListener('install', () => self.skipWaiting());

// Activate: clean ALL old caches + claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first for everything
// Vite already adds content hashes to JS/CSS — no need for SW caching of assets
self.addEventListener('fetch', (event) => {
  // Skip non-GET
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Skip API calls, chrome-extension, non-http
  if (url.pathname.startsWith('/api/')) return;
  if (!url.protocol.startsWith('http')) return;

  // Network-first: try network, fall back to cache for offline
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Only cache successful HTML responses (for offline shell)
        if (response.ok && event.request.headers.get('accept')?.includes('text/html')) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
