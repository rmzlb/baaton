import { LayoutDashboard, Inbox, Cpu, Eye, CheckCircle2, ArrowRight } from 'lucide-react';

const columns = [
  {
    name: 'Backlog',
    icon: Inbox,
    color: 'text-neutral-400',
    bg: 'bg-neutral-800',
    desc: 'Incoming tasks',
  },
  {
    name: 'AI Active',
    icon: Cpu,
    color: 'text-amber-500',
    bg: 'bg-amber-950/50',
    desc: 'Agent working',
    glow: true,
  },
  {
    name: 'Review',
    icon: Eye,
    color: 'text-blue-400',
    bg: 'bg-blue-950/30',
    desc: 'You validate',
  },
  {
    name: 'Done',
    icon: CheckCircle2,
    color: 'text-green-400',
    bg: 'bg-green-950/30',
    desc: 'Shipped',
  },
];

export function KanbanStep() {
  return (
    <div className="flex flex-col items-center text-center">
      {/* Icon */}
      <div className="relative mb-8">
        <div className="w-20 h-20 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
          <LayoutDashboard className="w-10 h-10 text-amber-500" strokeWidth={1.5} />
        </div>
      </div>

      <h2 className="font-display text-4xl uppercase tracking-tight text-white mb-3">
        The Kanban Flow
      </h2>

      <p className="text-lg text-neutral-400 max-w-md leading-relaxed mb-8 font-medium">
        Every ticket flows through four stages. You stay in control while{' '}
        <span className="text-white">AI handles the heavy lifting</span>.
      </p>

      {/* Column flow visualization */}
      <div className="w-full grid grid-cols-4 gap-2">
        {columns.map((col, i) => {
          const Icon = col.icon;
          return (
            <div key={col.name} className="flex flex-col items-center gap-2">
              <div
                className={`relative w-full rounded-xl border border-white/10 ${col.bg} p-3 flex flex-col items-center gap-2 transition-all`}
              >
                {col.glow && (
                  <div className="absolute inset-0 rounded-xl bg-amber-500/5 animate-pulse" />
                )}
                <div className="relative">
                  <Icon className={`w-5 h-5 ${col.color}`} strokeWidth={2} />
                </div>
                <span className={`text-xs font-bold uppercase tracking-wider ${col.color}`}>
                  {col.name}
                </span>
                <span className="text-[10px] text-neutral-600 font-medium">{col.desc}</span>
              </div>
              {i < columns.length - 1 && (
                <ArrowRight className="w-3 h-3 text-neutral-700 absolute translate-x-full hidden" />
              )}
            </div>
          );
        })}
      </div>

      {/* Flow arrows */}
      <div className="flex items-center gap-1 mt-4 text-neutral-600">
        <span className="text-xs font-mono">backlog</span>
        <ArrowRight className="w-3 h-3" />
        <span className="text-xs font-mono text-amber-500">ai active</span>
        <ArrowRight className="w-3 h-3" />
        <span className="text-xs font-mono">review</span>
        <ArrowRight className="w-3 h-3" />
        <span className="text-xs font-mono text-green-500">done</span>
      </div>
    </div>
  );
}
