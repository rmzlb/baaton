import { NavLink } from 'react-router-dom';
import { UserButton, OrganizationSwitcher } from '@clerk/clerk-react';
import {
  LayoutDashboard, Kanban, Settings, ChevronLeft, ChevronRight, Users,
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

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-30 flex flex-col border-r border-[#262626] bg-[#0a0a0a] transition-all duration-200',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      {/* Org Switcher */}
      <div className="flex h-14 items-center border-b border-[#262626] px-3">
        {collapsed ? (
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f59e0b] text-black font-bold text-sm mx-auto">
            B
          </div>
        ) : (
          <OrganizationSwitcher
            appearance={{
              elements: {
                rootBox: 'w-full',
                organizationSwitcherTrigger: 'w-full justify-start px-1 py-1 rounded-lg hover:bg-[#1f1f1f] text-white border-none',
              },
            }}
            afterCreateOrganizationUrl="/dashboard"
            afterSelectOrganizationUrl="/dashboard"
          />
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 p-2">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-[#1f1f1f] text-[#fafafa]'
                  : 'text-[#a1a1aa] hover:bg-[#141414] hover:text-[#fafafa]',
                collapsed && 'justify-center px-0',
              )
            }
          >
            <Icon size={20} />
            {!collapsed && <span>{label}</span>}
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
          className="rounded-md p-1.5 text-[#a1a1aa] hover:bg-[#141414] hover:text-[#fafafa] transition-colors"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </aside>
  );
}
