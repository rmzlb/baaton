import { FolderPlus, Sidebar, Plus, ChevronRight } from 'lucide-react';

export function CreateProjectStep() {
  return (
    <div className="flex flex-col items-center text-center">
      {/* Icon */}
      <div className="relative mb-8">
        <div className="w-20 h-20 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
          <FolderPlus className="w-10 h-10 text-amber-500" strokeWidth={1.5} />
        </div>
      </div>

      <h2 className="font-display text-4xl uppercase tracking-tight text-white mb-3">
        Create a Project
      </h2>

      <p className="text-lg text-neutral-400 max-w-md leading-relaxed mb-8 font-medium">
        Projects are your workspaces. Each project has its own
        <span className="text-white"> Kanban board</span>,
        <span className="text-white"> agents</span>, and
        <span className="text-white"> team members</span>.
      </p>

      {/* Mini sidebar mockup */}
      <div className="w-full max-w-xs rounded-xl border border-white/10 bg-[#111] overflow-hidden text-left">
        <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2">
          <Sidebar className="w-4 h-4 text-neutral-500" />
          <span className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Sidebar</span>
        </div>
        <div className="p-2 space-y-1">
          <div className="px-3 py-2 rounded-lg bg-white/5 flex items-center justify-between group">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-sm text-white font-medium">My First Project</span>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-neutral-600" />
          </div>
          <div className="px-3 py-2 rounded-lg border border-dashed border-white/10 flex items-center gap-2 text-neutral-500 hover:text-amber-500 hover:border-amber-500/30 transition-colors cursor-pointer">
            <Plus className="w-4 h-4" />
            <span className="text-sm font-medium">New project</span>
          </div>
        </div>
      </div>
    </div>
  );
}
