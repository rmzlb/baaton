import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useUIStore } from '@/stores/ui';
import { cn } from '@/lib/utils';

export function AppLayout() {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);

  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0a0a]">
      <Sidebar />
      <main
        className={cn(
          'flex-1 overflow-auto transition-all duration-200',
          collapsed ? 'ml-16' : 'ml-60',
        )}
      >
        <Outlet />
      </main>
    </div>
  );
}
