import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import { Link2, X, Plus, Ban, Copy, GitMerge } from 'lucide-react';

interface Relation {
  id: string;
  source_issue_id: string;
  target_issue_id: string;
  relation_type: string;
  created_by: string | null;
  created_at: string;
  // Joined fields from target issue
  target_display_id?: string;
  target_title?: string;
  target_status?: string;
}

interface RelationGroup {
  blocks: Relation[];
  blocked_by: Relation[];
  relates_to: Relation[];
  duplicate_of: Relation[];
}

const RELATION_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  blocks: { label: 'Blocks', icon: Ban, color: 'text-red-400' },
  blocked_by: { label: 'Blocked by', icon: Ban, color: 'text-orange-400' },
  relates_to: { label: 'Related to', icon: Link2, color: 'text-blue-400' },
  duplicate_of: { label: 'Duplicate of', icon: Copy, color: 'text-gray-400' },
};

const STATUS_DOT: Record<string, string> = {
  backlog: 'bg-gray-400',
  todo: 'bg-blue-400',
  in_progress: 'bg-yellow-400',
  in_review: 'bg-purple-400',
  done: 'bg-green-400',
  cancelled: 'bg-red-400',
};

export function IssueRelations({ issueId }: { issueId: string }) {
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [relationType, setRelationType] = useState('relates_to');

  const { data: relations, isLoading } = useQuery({
    queryKey: ['relations', issueId],
    queryFn: () => apiClient.get<RelationGroup>(`/issues/${issueId}/relations`),
    staleTime: 15_000,
  });

  const addMutation = useMutation({
    mutationFn: (body: { target_issue_id: string; relation_type: string }) =>
      apiClient.post(`/issues/${issueId}/relations`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['relations', issueId] });
      setShowAdd(false);
      setTargetId('');
    },
  });

  const removeMutation = useMutation({
    mutationFn: (relationId: string) =>
      apiClient.del(`/issues/${issueId}/relations/${relationId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['relations', issueId] });
    },
  });

  const allRelations = relations
    ? [...(relations.blocks || []), ...(relations.blocked_by || []), ...(relations.relates_to || []), ...(relations.duplicate_of || [])]
    : [];

  if (isLoading) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="flex items-center gap-1.5 text-[10px] text-muted uppercase tracking-wider font-medium">
          <GitMerge size={10} />
          Relations {allRelations.length > 0 && `(${allRelations.length})`}
        </label>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="text-muted hover:text-accent transition-colors"
        >
          <Plus size={12} />
        </button>
      </div>

      {/* Add relation form */}
      {showAdd && (
        <div className="flex items-center gap-2 mb-2 p-2 rounded-lg bg-surface-hover border border-border">
          <select
            value={relationType}
            onChange={e => setRelationType(e.target.value)}
            className="text-[11px] bg-transparent text-secondary border border-border rounded px-2 py-1"
          >
            {Object.entries(RELATION_CONFIG).map(([key, cfg]) => (
              <option key={key} value={key}>{cfg.label}</option>
            ))}
          </select>
          <input
            type="text"
            value={targetId}
            onChange={e => setTargetId(e.target.value)}
            placeholder="Issue UUID or display ID"
            className="flex-1 text-[11px] bg-transparent text-primary placeholder:text-muted outline-none border border-border rounded px-2 py-1"
          />
          <button
            onClick={() => addMutation.mutate({ target_issue_id: targetId, relation_type: relationType })}
            disabled={!targetId || addMutation.isPending}
            className="text-[10px] font-medium text-accent hover:text-accent-hover disabled:opacity-50 px-2 py-1"
          >
            Add
          </button>
          <button onClick={() => setShowAdd(false)} className="text-muted hover:text-secondary">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Relation groups */}
      {Object.entries(RELATION_CONFIG).map(([type, cfg]) => {
        const items = ((relations as unknown) as Record<string, Relation[]>)?.[type] || [];
        if (items.length === 0) return null;
        const Icon = cfg.icon;

        return (
          <div key={type} className="mb-2">
            <div className={`text-[10px] font-medium ${cfg.color} mb-1 flex items-center gap-1`}>
              <Icon size={10} />
              {cfg.label}
            </div>
            {items.map(rel => (
              <div key={rel.id} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-surface-hover group">
                <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[rel.target_status || ''] || 'bg-gray-400'}`} />
                <span className="text-[10px] text-muted font-mono">{rel.target_display_id || '?'}</span>
                <span className="text-[11px] text-secondary truncate flex-1">{rel.target_title || rel.target_issue_id}</span>
                <button
                  onClick={() => removeMutation.mutate(rel.id)}
                  className="opacity-0 group-hover:opacity-100 text-muted hover:text-red-400 transition-all"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        );
      })}

      {allRelations.length === 0 && !showAdd && (
        <p className="text-[11px] text-muted/50 italic">No relations</p>
      )}
    </div>
  );
}
