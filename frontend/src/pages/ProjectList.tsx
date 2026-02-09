import { Link } from 'react-router-dom';
import { Plus, Kanban } from '@phosphor-icons/react';

export function ProjectList() {
  // TODO: Fetch projects from API

  return (
    <div className="p-6">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#fafafa]">Projects</h1>
          <p className="mt-1 text-sm text-[#a1a1aa]">
            Manage your projects and boards
          </p>
        </div>
        <button className="flex items-center gap-2 rounded-lg bg-[#f59e0b] px-4 py-2 text-sm font-medium text-black hover:bg-[#d97706] transition-colors">
          <Plus size={16} weight="bold" />
          New Project
        </button>
      </div>

      {/* Empty state */}
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#262626] py-24">
        <Kanban size={48} className="text-[#a1a1aa] mb-4" weight="duotone" />
        <p className="text-sm text-[#a1a1aa]">No projects yet</p>
        <p className="mt-1 text-xs text-[#a1a1aa]">
          Create your first project to start collecting issues
        </p>
      </div>
    </div>
  );
}
