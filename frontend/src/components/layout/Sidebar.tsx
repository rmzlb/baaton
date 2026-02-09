import { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { UserButton, OrganizationSwitcher } from '@clerk/clerk-react';
import {
  LayoutDashboard, Kanban, Settings, ChevronLeft, ChevronRight, Users, X,
} from 'lucide-react';
import { useUIStore } from '@/stores/ui';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/projects', icon: Kanban, label: 'Projects' },
  { to: '/org', icon: Users, label: 'Team' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export function Sidebar() {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggle = useUIStore((s) => s.toggleSidebar);
  const mobileOpen = useUIStore((s) => s.sidebarMobileOpen);
  const closeMobile = useUIStore((s) => s.closeMobileSidebar);

  // Close mobile sidebar on route change (via escape or backdrop)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileOpen) closeMobile();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [mobileOpen, closeMobile]);

  // Auto-collapse on small screens
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)');
    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) {
        useUIStore.getState().setSidebarCollapsed(true);
      }
    };
    handleChange(mql);
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []);

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={closeMobile}
        />
      )}

      <aside
        className={cn(
          // Desktop: fixed left
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-[#262626] bg-[#0a0a0a] transition-all duration-200',
          // Desktop width
          collapsed ? 'w-16' : 'w-60',
          // Mobile: hidden by default, overlay when open
          'max-md:-translate-x-full max-md:w-60',
          mobileOpen && 'max-md:translate-x-0',
        )}
      >
        {/* Org Switcher / Header */}
        <div className="flex h-12 items-center border-b border-[#262626] px-3 justify-between">
          {collapsed && !mobileOpen ? (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f59e0b] text-black font-bold text-sm mx-auto">
              B
            </div>
          ) : (
            <OrganizationSwitcher
              appearance={{
                elements: {
                  rootBox: 'w-full',
                  organizationSwitcherTrigger:
                    'w-full justify-start px-1 py-1 rounded-lg hover:bg-[#1f1f1f] text-white border-none',
                },
              }}
              afterCreateOrganizationUrl="/dashboard"
              afterSelectOrganizationUrl="/dashboard"
            />
          )}
          {/* Close button on mobile */}
          {mobileOpen && (
            <button
              onClick={closeMobile}
              className="rounded-md p-1.5 text-[#a1a1aa] hover:bg-[#141414] hover:text-[#fafafa] transition-colors md:hidden shrink-0 ml-1"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 p-2">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              onClick={closeMobile}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors min-h-[44px]',
                  isActive
                    ? 'bg-[#1f1f1f] text-[#fafafa]'
                    : 'text-[#a1a1aa] hover:bg-[#141414] hover:text-[#fafafa]',
                  collapsed && !mobileOpen && 'justify-center px-0',
                )
              }
            >
              <Icon size={20} />
              {(!collapsed || mobileOpen) && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-[#262626] p-3 flex items-center justify-between">
          <UserButton
            appearance={{
              elements: { avatarBox: 'h-8 w-8' },
            }}
          />
          <button
            onClick={toggle}
            className="rounded-md p-1.5 text-[#a1a1aa] hover:bg-[#141414] hover:text-[#fafafa] transition-colors hidden md:block"
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
      </aside>
    </>
  );
}
