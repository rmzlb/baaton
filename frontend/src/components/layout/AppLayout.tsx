import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { AIAssistant } from '@/components/ai/AIAssistant';
import { ToastContainer } from '@/components/shared/Toast';
import { CommandPalette } from '@/components/shared/CommandPalette';
import { useUIStore } from '@/stores/ui';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useSSE } from '@/hooks/useSSE';
import { cn } from '@/lib/utils';

export function AppLayout() {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const aiPanelOpen = useUIStore((s) => s.aiPanelOpen);
  const [showCommandPalette, setShowCommandPalette] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(prev => !prev);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  useOnboarding();
  useSSE();

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
        <main
          id="main-content"
          className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-gutter:stable] [scroll-padding-top:3rem] [scroll-padding-bottom:env(safe-area-inset-bottom)]"
          tabIndex={-1}
        >
          <Outlet />
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
      {showCommandPalette && <CommandPalette onClose={() => setShowCommandPalette(false)} />}
    </div>
  );
}
