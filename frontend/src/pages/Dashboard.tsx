import { useOrganization } from '@clerk/clerk-react';

export function Dashboard() {
  const { organization } = useOrganization();

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#fafafa]">
          {organization?.name || 'Dashboard'}
        </h1>
        <p className="mt-1 text-sm text-[#a1a1aa]">
          Overview of your projects and recent activity
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Open Issues', value: '—', color: '#3b82f6' },
          { label: 'In Progress', value: '—', color: '#f59e0b' },
          { label: 'In Review', value: '—', color: '#8b5cf6' },
          { label: 'Done This Week', value: '—', color: '#22c55e' },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-[#262626] bg-[#141414] p-5"
          >
            <p className="text-xs text-[#a1a1aa] uppercase tracking-wider">
              {stat.label}
            </p>
            <p className="mt-2 text-3xl font-bold" style={{ color: stat.color }}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Recent Activity */}
      <div className="mt-8 rounded-xl border border-[#262626] bg-[#141414] p-6">
        <h2 className="text-sm font-semibold text-[#fafafa] uppercase tracking-wider">
          Recent Activity
        </h2>
        <div className="mt-4 flex items-center justify-center py-12 text-sm text-[#a1a1aa]">
          No activity yet. Create your first project to get started.
        </div>
      </div>
    </div>
  );
}
