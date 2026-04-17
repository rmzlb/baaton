import { CheckCircle2, ExternalLink } from 'lucide-react';

interface CreatedIssue {
  display_id?: string;
  title: string;
  status?: string;
  priority?: string;
  category?: string;
  project_name?: string;
  url?: string;
}

interface IssueCreatedProps {
  data: CreatedIssue | { issue?: CreatedIssue };
}

export default function IssueCreated({ data }: IssueCreatedProps) {
  const safe = (data ?? {}) as { issue?: CreatedIssue } & CreatedIssue;
  const issue: CreatedIssue = safe.issue ?? safe;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
      <CheckCircle2 size={18} className="text-emerald-400 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-xs font-semibold text-emerald-400">Issue created</p>
        <div className="flex items-center gap-2 flex-wrap">
          {issue.display_id && (
            <span className="font-mono text-[11px] text-[--color-muted]">{issue.display_id}</span>
          )}
          <span className="text-sm font-medium text-[--color-primary]">{issue.title ?? '(issue created)'}</span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-[--color-muted]">
          {issue.status && <span>Status: <span className="text-[--color-secondary]">{issue.status}</span></span>}
          {issue.priority && <span>Priority: <span className="text-[--color-secondary]">{issue.priority}</span></span>}
          {issue.category && <span>Category: <span className="text-[--color-secondary]">{issue.category}</span></span>}
          {issue.project_name && <span>Project: <span className="text-[--color-secondary]">{issue.project_name}</span></span>}
        </div>
        {issue.url && (
          <a
            href={issue.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-[--color-accent] hover:underline"
          >
            Open <ExternalLink size={10} />
          </a>
        )}
      </div>
    </div>
  );
}
