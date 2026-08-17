import { useEffect, useRef, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { AIAssistant } from '@/components/ai/AIAssistant';
import { ToastContainer } from '@/components/shared/Toast';
import { useUIStore } from '@/stores/ui';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useSSE } from '@/hooks/useSSE';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { cn } from '@/lib/utils';

export function AppLayout() {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const aiPanelOpen = useUIStore((s) => s.aiPanelOpen);
  const queryClient = useQueryClient();
  const mainRef = useRef<HTMLElement>(null);

  useOnboarding();
  useSSE();

  // Pull-to-refresh refetches every mounted query, so whatever page you're on
  // gets fresh data (dashboard statuses, boards, issue lists).
  const handleRefresh = useCallback(
    () => queryClient.refetchQueries({ type: 'active' }),
    [queryClient],
  );
  const { pull, progress, refreshing, armed } = usePullToRefresh({
    scrollRef: mainRef,
    onRefresh: handleRefresh,
  });
  // Content offset: follows the finger, then settles while refreshing.
  const offset = refreshing ? 24 : pull;

  // App-shell mode: lock document scroll only while the authenticated layout
  // is mounted. Public routes (Landing, Docs, sign-in) render *without*
  // AppLayout and keep their natural document scroll. Without this the iOS
  // Safari pull-to-refresh and macOS rubber-band can leak past the inner
  // <main> scroll container and visually break the app-shell illusion.
  useEffect(() => {
    document.documentElement.classList.add('app-shell-locked');
    return () => {
      document.documentElement.classList.remove('app-shell-locked');
    };
  }, []);

  return (
    <div className="flex h-dvh [@supports_not(height:100dvh)]:h-screen overflow-hidden overscroll-contain bg-bg text-primary">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-black focus:text-sm focus:font-medium focus:shadow-lg"
      >
        Skip to content
      </a>

      {/* Left sidebar */}
      <Sidebar />

      {/*
        Main content — left margin matches the docked left sidebar width
        so it doesn't slide under it. When the AI panel is open at lg+,
        we add a matching right margin so the panel PUSHES the page (mirror
        of the left sidebar pattern) instead of covering it. Below lg the
        panel is a full-screen overlay so no right margin is needed.
      */}
      <div
        className={cn(
          'flex flex-1 flex-col overflow-hidden transition-all duration-200 min-w-0',
          collapsed ? 'md:ml-14' : 'md:ml-56',
          aiPanelOpen && 'lg:mr-[420px]',
          'ml-0',
        )}
      >
        <TopBar />
        {/* Pull-to-refresh affordance — overlays the top of the scroller. */}
        <div
          aria-hidden={pull === 0 && !refreshing}
          className="pointer-events-none relative z-30 flex justify-center overflow-visible"
        >
          <div
            className={cn(
              'absolute top-1 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface shadow-lg',
              !pull && !refreshing && 'opacity-0',
            )}
            style={{
              transform: `translateY(${(refreshing ? 48 : pull) - 40}px)`,
              opacity: refreshing ? 1 : progress,
              transition: pull === 0 || refreshing ? 'transform 180ms ease-out, opacity 180ms ease-out' : 'none',
            }}
          >
            <RefreshCw
              size={14}
              className={cn(
                refreshing ? 'animate-spin text-accent' : armed ? 'text-accent' : 'text-muted',
              )}
              style={refreshing ? undefined : { transform: `rotate(${progress * 270}deg)` }}
            />
          </div>
        </div>
        <main
          ref={mainRef}
          id="main-content"
          className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-gutter:stable] [scroll-padding-top:3rem] [scroll-padding-bottom:env(safe-area-inset-bottom)]"
          tabIndex={-1}
        >
          {/*
            The pull offset is applied only while the gesture is live. A
            permanent `transform` (even translateY(0)) would create a containing
            block and reparent every `position: fixed` child (issue drawer,
            modals, command palette) to this div instead of the viewport.
          */}
          <div
            style={
              offset > 0
                ? {
                  transform: `translateY(${offset}px)`,
                  transition: refreshing || pull === 0 ? 'transform 180ms ease-out' : 'none',
                }
                : undefined
            }
          >
            <Outlet />
          </div>
        </main>
      </div>

      {/* Right AI panel */}
      <AIAssistant />

      {/* Overlays */}
      <div
        id="a11y-announcer"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        role="status"
      />
      <ToastContainer />
    </div>
  );
}
