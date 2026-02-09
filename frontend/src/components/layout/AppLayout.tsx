import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { AIAssistant } from '@/components/ai/AIAssistant';
import { ToastContainer } from '@/components/shared/Toast';
import { useUIStore } from '@/stores/ui';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useSSE } from '@/hooks/useSSE';
import { cn } from '@/lib/utils';

export function AppLayout() {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);

  // Onboarding tour — auto-starts for first-time users
  useOnboarding();

  // Global SSE connection for real-time updates + notifications
  useSSE();

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-primary">
      {/* Skip to content link for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-black focus:text-sm focus:font-medium focus:shadow-lg"
      >
        Skip to content
      </a>
      <Sidebar />
      <div
        className={cn(
          'flex flex-1 flex-col overflow-hidden transition-all duration-200',
          // Desktop: offset for sidebar
          collapsed ? 'md:ml-16' : 'md:ml-60',
          // Mobile: no offset (sidebar is overlay)
          'ml-0',
        )}
      >
        <TopBar />
        <main id="main-content" className="flex-1 overflow-auto" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      {/* Live region for screen reader announcements */}
      <div
        id="a11y-announcer"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        role="status"
      />
      <AIAssistant />
      <ToastContainer />
    </div>
  );
}
