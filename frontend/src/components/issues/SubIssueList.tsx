import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import { Plus, X, ChevronDown, ChevronRight, CircleDot } from 'lucide-react';

interface SubIssue {
  id: string;
  display_id: string;
  title: string;
  status: string;
  priority: string;
  assignee_ids: string[];
}

const STATUS_COLORS: Record<string, string> = {
  backlog: 'text-gray-400',
  todo: 'text-blue-400',
  in_progress: 'text-yellow-400',
  in_review: 'text-purple-400',
  done: 'text-green-400',
  cancelled: 'text-red-400',
};

export function SubIssueList({ issueId, projectId }: { issueId: string; projectId: string }) {
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  const { data: children = [], isLoading } = useQuery({
    queryKey: ['children', issueId],
    queryFn: () => apiClient.get<SubIssue[]>(`/issues/${issueId}/children`),
    staleTime: 15_000,
  });

  const createMutation = useMutation({
    mutationFn: (title: string) =>
      apiClient.post('/issues', {
        title,
        project_id: projectId,
        parent_id: issueId,
        status: 'todo',
        priority: 'medium',
        issue_type: 'feature',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['children', issueId] });
      queryClient.invalidateQueries({ queryKey: ['project-board'] });
      setShowCreate(false);
      setNewTitle('');
    },
  });

  const completed = children.filter(c => c.status === 'done' || c.status === 'cancelled').length;
  const total = children.length;
  const progress = total > 0 ? (completed / total) * 100 : 0;

  if (isLoading) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-1.5 text-[10px] text-muted uppercase tracking-wider font-medium hover:text-secondary transition-colors"
        >
          {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
          Sub-issues
          {total > 0 && (
            <span className="text-accent normal-case tracking-normal">
              {completed}/{total}
            </span>
          )}
        </button>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="text-muted hover:text-accent transition-colors"
        >
          <Plus size={12} />
        </button>
      </div>

      {/* Progress bar */}
      {total > 0 && !collapsed && (
        <div className="h-1 rounded-full bg-surface-hover mb-2 overflow-hidden">
          <div
            className="h-full rounded-full bg-green-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="flex items-center gap-2 mb-2 p-2 rounded-lg bg-surface-hover border border-border">
          <input
            type="text"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && newTitle.trim()) createMutation.mutate(newTitle.trim());
              if (e.key === 'Escape') setShowCreate(false);
            }}
            placeholder="Sub-issue title..."
            className="flex-1 text-[11px] bg-transparent text-primary placeholder:text-muted outline-none"
            autoFocus
          />
          <button
            onClick={() => newTitle.trim() && createMutation.mutate(newTitle.trim())}
            disabled={!newTitle.trim() || createMutation.isPending}
            className="text-[10px] font-medium text-accent hover:text-accent-hover disabled:opacity-50"
          >
            {createMutation.isPending ? '...' : 'Create'}
          </button>
          <button onClick={() => setShowCreate(false)} className="text-muted hover:text-secondary">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Children list */}
      {!collapsed && children.map(child => (
        <div key={child.id} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-surface-hover group">
          <CircleDot size={12} className={STATUS_COLORS[child.status] || 'text-gray-400'} />
          <span className="text-[10px] text-muted font-mono">{child.display_id}</span>
          <span className={`text-[11px] flex-1 truncate ${child.status === 'done' ? 'text-muted line-through' : 'text-secondary'}`}>
            {child.title}
          </span>
        </div>
      ))}

      {!collapsed && total === 0 && !showCreate && (
        <p className="text-[11px] text-muted/50 italic">No sub-issues</p>
      )}
    </div>
  );
}
