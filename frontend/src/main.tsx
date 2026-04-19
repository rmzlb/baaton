import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ClerkProvider } from '@clerk/clerk-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { ThemeProvider } from './components/ThemeProvider';
import '@/lib/i18n';
import 'driver.js/dist/driver.css';
import './styles/onboarding.css';
import './styles/globals.css';

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!CLERK_KEY) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY');
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      retry: 1,
    },
  },
});

// Register service worker for PWA
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// ─── Stale-chunk auto-recovery ────────────────────────────────────────────────
// When we deploy, Vite emits new chunk filenames (hash-based). A user with the
// app already open has the *old* index.html cached in memory, which still
// references the *old* chunk filenames. The first time their session triggers
// a lazy import (route change, modal open, tool-component mount…) the browser
// requests a chunk that no longer exists on the server → "Failed to fetch
// dynamically imported module".
//
// Vite 5+ fires `vite:preloadError` on window for exactly this case. Reload
// once to pick up the new index.html. Guard with sessionStorage so we never
// loop if the error is genuine (network down, build broken).
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    const RELOAD_KEY = 'baaton:chunk-reload-attempted';
    if (sessionStorage.getItem(RELOAD_KEY)) {
      console.error('[chunk] preload failed even after reload — giving up', event);
      return;
    }
    sessionStorage.setItem(RELOAD_KEY, '1');
    console.warn('[chunk] stale chunk detected, reloading to pick up new build');
    event.preventDefault();
    window.location.reload();
  });

  // Clear the reload flag once the new build has booted successfully.
  // Wait a tick so any synchronous chunk failure has time to fire first.
  setTimeout(() => sessionStorage.removeItem('baaton:chunk-reload-attempted'), 5000);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ClerkProvider
        publishableKey={CLERK_KEY}
        signInUrl="/sign-in"
        signUpUrl="/sign-up"
        signInFallbackRedirectUrl="/dashboard"
        signUpFallbackRedirectUrl="/dashboard"
        afterSignOutUrl="/sign-in"
      >
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </ClerkProvider>
    </ThemeProvider>
  </StrictMode>,
);

