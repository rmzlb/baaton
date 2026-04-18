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

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-primary">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-black focus:text-sm focus:font-medium focus:shadow-lg"
      >
        Skip to content
      </a>

      {/* Left sidebar */}
      <Sidebar />

      {/*
        Main content — left margin matches sidebar width so it doesn't slide under it.
        On lg+ the AI panel docks (static), so no width compensation is needed here.
        On < lg the AI panel is an overlay (with backdrop) — main stays full width.
      */}
      <div
        className={cn(
          'flex flex-1 flex-col overflow-hidden transition-all duration-200 min-w-0',
          collapsed ? 'md:ml-14' : 'md:ml-56',
          aiPanelOpen && 'lg:ml-14',
          'ml-0',
        )}
      >
        <TopBar />
        <main id="main-content" className="flex-1 overflow-auto" tabIndex={-1}>
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
