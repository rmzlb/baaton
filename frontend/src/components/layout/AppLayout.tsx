import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { AIAssistant } from '@/components/ai/AIAssistant';
import { useUIStore } from '@/stores/ui';
import { useOnboarding } from '@/hooks/useOnboarding';
import { cn } from '@/lib/utils';

export function AppLayout() {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);

  // Onboarding tour — auto-starts for first-time users
  useOnboarding();

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-primary">
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
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <AIAssistant />
    </div>
  );
}
