import { useTranslation } from '@/hooks/useTranslation';
import type { ProjectStatus } from '@/lib/types';

interface GitHubStatusMappingEditorProps {
  statusMapping: Record<string, string | null>;
  projectStatuses: ProjectStatus[];
  onChange: (mapping: Record<string, string | null>) => void;
}

const PR_EVENTS = [
  { key: 'pr_opened', labelKey: 'github.mapping.prOpened' },
  { key: 'pr_draft', labelKey: 'github.mapping.prDraft' },
  { key: 'pr_ready_for_review', labelKey: 'github.mapping.prReady' },
  { key: 'pr_review_approved', labelKey: 'github.mapping.prApproved' },
  { key: 'pr_merged', labelKey: 'github.mapping.prMerged' },
  { key: 'pr_closed', labelKey: 'github.mapping.prClosed' },
];

const ISSUE_EVENTS = [
  { key: 'issue_opened', labelKey: 'github.mapping.issueOpened' },
  { key: 'issue_closed', labelKey: 'github.mapping.issueClosed' },
  { key: 'issue_reopened', labelKey: 'github.mapping.issueReopened' },
];

const DEFAULT_MAPPING: Record<string, string | null> = {
  issue_opened: 'todo',
  issue_closed: 'done',
  issue_reopened: 'todo',
  pr_opened: 'in_progress',
  pr_draft: null,
  pr_ready_for_review: 'in_review',
  pr_review_approved: 'in_review',
  pr_merged: 'done',
  pr_closed: null,
};

export function GitHubStatusMappingEditor({
  statusMapping,
  projectStatuses,
  onChange,
}: GitHubStatusMappingEditorProps) {
  const { t } = useTranslation();

  const handleChange = (eventKey: string, statusKey: string | null) => {
    onChange({ ...statusMapping, [eventKey]: statusKey });
  };

  const handleReset = () => {
    onChange(DEFAULT_MAPPING);
  };

  const renderRow = (eventKey: string, labelKey: string) => (
    <div key={eventKey} className="flex items-center justify-between gap-4">
      <span className="text-sm text-primary whitespace-nowrap">{t(labelKey)}</span>
      <select
        value={statusMapping[eventKey] ?? '__none__'}
        onChange={(e) => {
          const val = e.target.value;
          handleChange(eventKey, val === '__none__' ? null : val);
        }}
        className="rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-primary outline-none focus:border-accent transition-colors min-w-[160px]"
      >
        <option value="__none__">— {t('github.mapping.dontChange')} —</option>
        {projectStatuses.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* PR State Mapping */}
      <div>
        <h4 className="text-xs font-semibold text-secondary uppercase tracking-wider mb-3">
          {t('github.mapping.prTitle')}
        </h4>
        <div className="space-y-2">
          {PR_EVENTS.map((e) => renderRow(e.key, e.labelKey))}
        </div>
      </div>

      {/* Issue State Mapping */}
      <div>
        <h4 className="text-xs font-semibold text-secondary uppercase tracking-wider mb-3">
          {t('github.mapping.issueTitle')}
        </h4>
        <div className="space-y-2">
          {ISSUE_EVENTS.map((e) => renderRow(e.key, e.labelKey))}
        </div>
      </div>

      {/* Reset button */}
      <button
        type="button"
        onClick={handleReset}
        className="text-xs text-muted hover:text-accent transition-colors"
      >
        {t('github.mapping.resetDefaults')}
      </button>
    </div>
  );
}
