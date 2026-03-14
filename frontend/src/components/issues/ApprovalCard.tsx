import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle, Clock, ShieldCheck, AlertTriangle, MessageSquare } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { cn, timeAgo } from '@/lib/utils';
import type { Comment } from '@/lib/types';

interface ApprovalCardProps {
  comment: Comment;
  issueId: string;
}

export function ApprovalCard({ comment, issueId }: ApprovalCardProps) {
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const [decisionComment, setDecisionComment] = useState('');
  const [showCommentInput, setShowCommentInput] = useState(false);

  const meta = comment.approval_metadata;
  const isPending = comment.approval_status === 'pending';
  const isApproved = comment.approval_status === 'approved';
  const isRejected = comment.approval_status === 'rejected' || comment.approval_status === 'request_changes';

  const respondMutation = useMutation({
    mutationFn: (decision: string) =>
      apiClient.post(`/issues/${issueId}/approval-response`, {
        approval_comment_id: comment.id,
        decision,
        comment: decisionComment || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
      queryClient.invalidateQueries({ queryKey: ['activity', issueId] });
      setDecisionComment('');
      setShowCommentInput(false);
    },
  });

  const confidence = meta?.confidence;
  const confidencePct = confidence != null ? Math.round(confidence * 100) : null;

  return (
    <div
      className={cn(
        'rounded-lg border p-3 shadow-sm',
        isPending && 'border-amber-500/30 bg-amber-500/5 border-l-[3px] border-l-amber-500',
        isApproved && 'border-emerald-500/30 bg-emerald-500/5 border-l-[3px] border-l-emerald-500',
        isRejected && 'border-red-500/30 bg-red-500/5 border-l-[3px] border-l-red-500',
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <ShieldCheck size={14} className={cn(
          isPending && 'text-amber-400',
          isApproved && 'text-emerald-400',
          isRejected && 'text-red-400',
        )} />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-secondary">
          Approval Request
        </span>
        <span className={cn(
          'text-[10px] font-medium px-1.5 py-0.5 rounded-full',
          isPending && 'bg-amber-500/20 text-amber-400',
          isApproved && 'bg-emerald-500/20 text-emerald-400',
          isRejected && 'bg-red-500/20 text-red-400',
        )}>
          {isPending ? 'Pending' : isApproved ? 'Approved' : 'Rejected'}
        </span>
        <span className="text-[10px] text-muted ml-auto">{timeAgo(comment.created_at)}</span>
      </div>

      {/* Action name */}
      {meta?.action && (
        <div className="text-xs font-mono text-primary bg-surface-hover rounded px-2 py-1 mb-2 inline-block">
          {meta.action}
        </div>
      )}

      {/* Description */}
      <p className="text-xs text-secondary leading-relaxed mb-2">{comment.body}</p>

      {/* Confidence bar */}
      {confidencePct != null && (
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] text-muted">Confidence</span>
          <div className="flex-1 h-1.5 bg-surface-hover rounded-full overflow-hidden max-w-[120px]">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                confidencePct >= 80 ? 'bg-emerald-500' :
                confidencePct >= 50 ? 'bg-amber-500' : 'bg-red-500',
              )}
              style={{ width: `${confidencePct}%` }}
            />
          </div>
          <span className="text-[10px] font-medium text-secondary">{confidencePct}%</span>
        </div>
      )}

      {/* Requester */}
      <div className="text-[10px] text-muted mb-2">
        Requested by <span className="text-secondary font-medium">{comment.author_name}</span>
      </div>

      {/* Decision info (if resolved) */}
      {!isPending && meta?.decided_by_name && (
        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border/50">
          {isApproved ? (
            <CheckCircle2 size={12} className="text-emerald-400" />
          ) : (
            <XCircle size={12} className="text-red-400" />
          )}
          <span className="text-[11px] text-secondary">
            {isApproved ? 'Approved' : 'Rejected'} by{' '}
            <span className="font-medium text-primary">{meta.decided_by_name}</span>
          </span>
          {meta.decided_at && (
            <span className="text-[10px] text-muted ml-auto">{timeAgo(meta.decided_at)}</span>
          )}
        </div>
      )}
      {!isPending && meta?.decision_comment && (
        <p className="text-[11px] text-muted mt-1 italic">"{meta.decision_comment}"</p>
      )}

      {/* Action buttons (pending only) */}
      {isPending && (
        <div className="mt-3 pt-2 border-t border-border/50">
          {showCommentInput && (
            <div className="mb-2">
              <input
                type="text"
                value={decisionComment}
                onChange={(e) => setDecisionComment(e.target.value)}
                placeholder="Optional comment..."
                className="w-full rounded-md border border-border bg-surface-hover px-2.5 py-1.5 text-xs text-primary placeholder:text-muted focus:border-accent focus:outline-none"
              />
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => respondMutation.mutate('approved')}
              disabled={respondMutation.isPending}
              className="flex items-center gap-1.5 rounded-md bg-emerald-500/20 px-3 py-1.5 text-[11px] font-medium text-emerald-400 hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
            >
              <CheckCircle2 size={12} />
              Approve
            </button>
            <button
              onClick={() => respondMutation.mutate('rejected')}
              disabled={respondMutation.isPending}
              className="flex items-center gap-1.5 rounded-md bg-red-500/20 px-3 py-1.5 text-[11px] font-medium text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50"
            >
              <XCircle size={12} />
              Reject
            </button>
            <button
              onClick={() => setShowCommentInput(!showCommentInput)}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] text-muted hover:text-secondary hover:bg-surface-hover transition-colors ml-auto"
            >
              <MessageSquare size={10} />
              {showCommentInput ? 'Hide' : 'Add note'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
