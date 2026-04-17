import { PenLine, ArrowRight } from 'lucide-react';

interface ChangeEntry {
  field: string;
  from?: unknown;
  to?: unknown;
}

interface UpdatedIssue {
  display_id?: string;
  title: string;
}

interface IssueUpdatedData {
  issue?: UpdatedIssue;
  display_id?: string;
  title?: string;
  changes?: ChangeEntry[];
  updated_fields?: string[];
}

interface IssueUpdatedProps {
  data: IssueUpdatedData;
}

function renderValue(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

export default function IssueUpdated({ data }: IssueUpdatedProps) {
  const safe = data ?? ({} as IssueUpdatedData);
  const issue = safe.issue ?? { display_id: safe.display_id, title: safe.title ?? '(issue updated)' };

  const changes: ChangeEntry[] = safe.changes
    ?? (safe.updated_fields?.map((f) => ({ field: f })) ?? []);

  return (
    <div className="flex items-start gap-3 rounded-lg border border-blue-500/30 bg-blue-500/5 px-4 py-3">
      <PenLine size={16} className="text-blue-400 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 space-y-2">
        <p className="text-xs font-semibold text-blue-400">Issue updated</p>
        <div className="flex items-center gap-2 flex-wrap">
          {issue.display_id && (
            <span className="font-mono text-[11px] text-[--color-muted]">{issue.display_id}</span>
          )}
          <span className="text-sm font-medium text-[--color-primary]">{issue.title}</span>
        </div>

        {changes.length > 0 && (
          <ul className="space-y-1">
            {changes.map((c, i) => (
              <li key={i} className="flex items-center gap-1.5 text-[11px]">
                <span className="capitalize text-[--color-muted] min-w-[80px]">{c.field}</span>
                {c.from != null && (
                  <>
                    <span className="text-[--color-muted] line-through">{renderValue(c.from)}</span>
                    <ArrowRight size={10} className="text-[--color-muted] shrink-0" />
                  </>
                )}
                {c.to != null && (
                  <span className="text-[--color-primary] font-medium">{renderValue(c.to)}</span>
                )}
                {c.from == null && c.to == null && (
                  <span className="text-[--color-secondary]">changed</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
