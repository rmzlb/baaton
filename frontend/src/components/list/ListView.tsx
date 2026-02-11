import { useState, useMemo, useCallback } from 'react';
import {
  Search, ChevronDown, ChevronRight,
  ArrowUp, ArrowDown, Minus, OctagonAlert,
  Tag, User, X, Layers, Inbox, SearchX,
} from 'lucide-react';
import { ListRow } from './ListRow';
import { EmptyState } from '@/components/shared/EmptyState';
import { IssueContextMenu, DeleteConfirmModal, useIssueContextMenu } from '@/components/shared/IssueContextMenu';
import { BulkActionBar, useBulkKeyboardShortcuts } from '@/components/shared/BulkActionBar';
import { useSelection } from '@/hooks/useSelection';
import { useIssueMutations } from '@/hooks/useIssueMutations';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import type { Issue, IssuePriority, IssueStatus, ProjectStatus, ProjectTag } from '@/lib/types';

type SortField = 'display_id' | 'title' | 'status' | 'priority' | 'type' | 'created_at' | 'updated_at';
type SortDir = 'asc' | 'desc';

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const PRIORITY_CONFIG: { key: IssuePriority; label: string; color: string; icon: typeof ArrowUp }[] = [
  { key: 'urgent', label: 'Urgent', color: '#ef4444', icon: OctagonAlert },
  { key: 'high', label: 'High', color: '#f97316', icon: ArrowUp },
  { key: 'medium', label: 'Medium', color: '#eab308', icon: Minus },
  { key: 'low', label: 'Low', color: '#6b7280', icon: ArrowDown },
];

const CATEGORY_CONFIG: { key: string; label: string; color: string }[] = [
  { key: 'FRONT', label: 'Frontend', color: '#3b82f6' },
  { key: 'BACK', label: 'Backend', color: '#22c55e' },
  { key: 'API', label: 'API', color: '#8b5cf6' },
  { key: 'DB', label: 'Database', color: '#f97316' },
];

interface Project {
  id: string;
  name: string;
  prefix: string;
}

interface ListViewProps {
  statuses: ProjectStatus[];
  issues: Issue[];
  onIssueClick: (issue: Issue) => void;
  projectTags?: ProjectTag[];
  projects?: Project[];
  hideFilterBar?: boolean;
}

export function ListView({ statuses, issues, onIssueClick, projectTags = [], projects = [], hideFilterBar = false }: ListViewProps) {
  const { t } = useTranslation();
  const {
    contextMenu, setContextMenu, deleteTarget, setDeleteTarget,
    handleContextMenu, handleStatusChange, handlePriorityChange,
    handleDeleteConfirm, handleCopyId, handleOpen,
  } = useIssueContextMenu(statuses, onIssueClick);
  const { selectedIds, toggle: toggleSelect, selectAll, deselectAll } = useSelection();
  const mutations = useIssueMutations();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('status');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [groupBy, setGroupBy] = useState<'none' | 'status' | 'priority' | 'project' | 'assignee'>('status');

  // Filters
  const [selectedPriorities, setSelectedPriorities] = useState<IssuePriority[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  const hasActiveFilters = selectedPriorities.length > 0 || selectedTags.length > 0 || selectedAssignees.length > 0 || selectedCategories.length > 0;

  const uniqueAssignees = useMemo(() => {
    const ids = new Set<string>();
    issues.forEach((i) => i.assignee_ids.forEach((a) => ids.add(a)));
    return Array.from(ids);
  }, [issues]);

  const uniqueTags = useMemo(() => {
    const tags = new Set<string>();
    issues.forEach((i) => i.tags.forEach((t) => tags.add(t)));
    return Array.from(tags).sort();
  }, [issues]);

  // Filter
  const filteredIssues = useMemo(() => {
    let result = issues;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.display_id.toLowerCase().includes(q) ||
          i.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    if (selectedPriorities.length > 0) {
      result = result.filter((i) => i.priority && selectedPriorities.includes(i.priority));
    }
    if (selectedTags.length > 0) {
      result = result.filter((i) => i.tags.some((t) => selectedTags.includes(t)));
    }
    if (selectedAssignees.length > 0) {
      result = result.filter((i) => i.assignee_ids.some((a) => selectedAssignees.includes(a)));
    }
    if (selectedCategories.length > 0) {
      result = result.filter((i) => (i.category || []).some((c) => selectedCategories.includes(c.toUpperCase())));
    }
    return result;
  }, [issues, searchQuery, selectedPriorities, selectedTags, selectedAssignees, selectedCategories]);

  // Sort
  const sortedIssues = useMemo(() => {
    const sorted = [...filteredIssues];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'display_id':
          cmp = a.display_id.localeCompare(b.display_id);
          break;
        case 'title':
          cmp = a.title.localeCompare(b.title);
          break;
        case 'status': {
          const aIdx = statuses.findIndex((s) => s.key === a.status);
          const bIdx = statuses.findIndex((s) => s.key === b.status);
          cmp = aIdx - bIdx;
          break;
        }
        case 'priority':
          cmp = (PRIORITY_ORDER[a.priority || ''] ?? 4) - (PRIORITY_ORDER[b.priority || ''] ?? 4);
          break;
        case 'type':
          cmp = a.type.localeCompare(b.type);
          break;
        case 'created_at':
          cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
        case 'updated_at':
          cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filteredIssues, sortField, sortDir, statuses]);

  // Generic grouping
  const groupedIssues = useMemo(() => {
    if (groupBy === 'none') {
      return [{ key: '__all__', label: 'All Issues', color: undefined as string | undefined, issues: sortedIssues }];
    }
    if (groupBy === 'status') {
      return statuses
        .map((s) => ({
          key: s.key,
          label: s.label,
          color: s.color,
          issues: sortedIssues.filter((i) => i.status === s.key),
        }))
        .filter((g) => g.issues.length > 0);
    }
    if (groupBy === 'priority') {
      const order = ['urgent', 'high', 'medium', 'low', '__none__'];
      const labels: Record<string, string> = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low', __none__: 'No Priority' };
      const colors: Record<string, string> = { urgent: '#ef4444', high: '#f97316', medium: '#eab308', low: '#6b7280', __none__: '#4b5563' };
      return order
        .map((key) => ({
          key,
          label: labels[key],
          color: colors[key],
          issues: sortedIssues.filter((i) => key === '__none__' ? !i.priority : i.priority === key),
        }))
        .filter((g) => g.issues.length > 0);
    }
    if (groupBy === 'project') {
      return projects
        .map((p) => ({
          key: p.id,
          label: `${p.prefix} — ${p.name}`,
          color: undefined as string | undefined,
          issues: sortedIssues.filter((i) => i.project_id === p.id),
        }))
        .filter((g) => g.issues.length > 0);
    }
    if (groupBy === 'assignee') {
      const assigneeMap = new Map<string, Issue[]>();
      for (const issue of sortedIssues) {
        const key = issue.assignee_ids[0] || '__unassigned__';
        if (!assigneeMap.has(key)) assigneeMap.set(key, []);
        assigneeMap.get(key)!.push(issue);
      }
      return Array.from(assigneeMap.entries()).map(([key, issues]) => ({
        key,
        label: key === '__unassigned__' ? 'Unassigned' : key.slice(0, 12),
        color: undefined as string | undefined,
        issues,
      }));
    }
    return [{ key: '__all__', label: 'All', color: undefined as string | undefined, issues: sortedIssues }];
  }, [sortedIssues, statuses, projects, groupBy]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const togglePriority = (p: IssuePriority) =>
    setSelectedPriorities((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );

  const toggleTag = (t: string) =>
    setSelectedTags((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );

  const toggleAssignee = (a: string) =>
    setSelectedAssignees((prev) =>
      prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a],
    );

  const toggleCategory = (c: string) =>
    setSelectedCategories((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );

  const clearAllFilters = () => {
    setSelectedPriorities([]);
    setSelectedTags([]);
    setSelectedAssignees([]);
    setSelectedCategories([]);
    setSearchQuery('');
  };

  // All issue IDs in current sort order for shift-select
  const allIssueIds = useMemo(() => sortedIssues.map((i) => i.id), [sortedIssues]);

  // Bulk actions via keyboard
  const bulkMarkDone = useCallback(() => {
    mutations.bulkUpdateStatus(Array.from(selectedIds), 'done' as IssueStatus);
    deselectAll();
  }, [selectedIds, mutations, deselectAll]);

  const bulkMarkCancelled = useCallback(() => {
    mutations.bulkUpdateStatus(Array.from(selectedIds), 'cancelled' as IssueStatus);
    deselectAll();
  }, [selectedIds, mutations, deselectAll]);

  const bulkDeleteKb = useCallback(() => {
    if (!confirm(`Delete ${selectedIds.size} issue(s)?`)) return;
    mutations.bulkDelete(Array.from(selectedIds));
    deselectAll();
  }, [selectedIds, mutations, deselectAll]);

  useBulkKeyboardShortcuts(selectedIds, statuses, bulkMarkDone, bulkMarkCancelled, bulkDeleteKb, deselectAll);

  const SortIcon = ({ field }: { field: SortField }) =>
    sortField === field ? (
      <span className="text-accent text-[10px] ml-0.5">
        {sortDir === 'asc' ? '↑' : '↓'}
      </span>
    ) : null;

  return (
    <div className="flex h-full flex-col">
      {/* Filter Bar */}
      {!hideFilterBar && <div className="relative flex flex-wrap items-center gap-1.5 md:gap-2 border-b border-border px-3 md:px-6 py-2 overflow-visible z-30">
        <div className="relative shrink-0">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('kanban.filterIssues')}
            aria-label={t('kanban.filterIssues') || 'Filter issues'}
            className="h-8 w-32 sm:w-48 rounded-md border border-border bg-surface pl-8 pr-3 text-xs text-primary placeholder-muted outline-none focus:border-accent transition-colors"
          />
        </div>

        {/* Priority Filter */}
        <FilterDropdown
          icon={<OctagonAlert size={12} />}
          label={t('kanban.priority')}
          count={selectedPriorities.length}
        >
          {PRIORITY_CONFIG.map((p) => (
            <button
              key={p.key}
              onClick={() => togglePriority(p.key)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors',
                selectedPriorities.includes(p.key)
                  ? 'text-primary bg-surface-hover'
                  : 'text-secondary hover:bg-surface-hover',
              )}
            >
              <p.icon size={12} style={{ color: p.color }} />
              {p.label}
              {selectedPriorities.includes(p.key) && <span className="ml-auto text-accent">✓</span>}
            </button>
          ))}
        </FilterDropdown>

        {/* Category Filter */}
        <FilterDropdown icon={<Layers size={12} />} label={t('kanban.category')} count={selectedCategories.length}>
          {CATEGORY_CONFIG.map((c) => (
            <button
              key={c.key}
              onClick={() => toggleCategory(c.key)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors',
                selectedCategories.includes(c.key) ? 'text-primary bg-surface-hover' : 'text-secondary hover:bg-surface-hover',
              )}
            >
              <span className="h-2.5 w-2.5 rounded shrink-0" style={{ backgroundColor: c.color }} />
              {c.label}
              {selectedCategories.includes(c.key) && <span className="ml-auto text-accent">✓</span>}
            </button>
          ))}
        </FilterDropdown>

        {uniqueTags.length > 0 && (
          <FilterDropdown icon={<Tag size={12} />} label={t('kanban.tags')} count={selectedTags.length}>
            {uniqueTags.map((tag) => {
              const tagObj = projectTags.find((t) => t.name === tag);
              return (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors',
                    selectedTags.includes(tag) ? 'text-primary bg-surface-hover' : 'text-secondary hover:bg-surface-hover',
                  )}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tagObj?.color || '#6b7280' }} />
                  {tag}
                  {selectedTags.includes(tag) && <span className="ml-auto text-accent">✓</span>}
                </button>
              );
            })}
          </FilterDropdown>
        )}

        {uniqueAssignees.length > 0 && (
          <FilterDropdown icon={<User size={12} />} label={t('kanban.assignee')} count={selectedAssignees.length}>
            {uniqueAssignees.map((a) => (
              <button
                key={a}
                onClick={() => toggleAssignee(a)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors',
                  selectedAssignees.includes(a) ? 'text-primary bg-surface-hover' : 'text-secondary hover:bg-surface-hover',
                )}
              >
                <div className="h-5 w-5 rounded-full bg-border flex items-center justify-center text-[8px] font-mono text-secondary">
                  {a.slice(0, 2).toUpperCase()}
                </div>
                <span className="truncate">{a}</span>
                {selectedAssignees.includes(a) && <span className="ml-auto text-accent">✓</span>}
              </button>
            ))}
          </FilterDropdown>
        )}

        {hasActiveFilters && (
          <button
            onClick={clearAllFilters}
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] text-accent hover:bg-accent/10 transition-colors"
          >
            <X size={12} />
            {t('kanban.clearAll')}
          </button>
        )}

        {/* Group By dropdown */}
        <FilterDropdown icon={<Layers size={12} />} label={`Group: ${groupBy === 'none' ? 'None' : groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}`} count={groupBy !== 'status' ? 1 : 0}>
          {(['none', 'status', 'priority', 'project', 'assignee'] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => setGroupBy(opt)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors',
                groupBy === opt ? 'text-primary bg-surface-hover' : 'text-secondary hover:bg-surface-hover',
              )}
            >
              {opt.charAt(0).toUpperCase() + opt.slice(1)}
              {groupBy === opt && <span className="ml-auto text-accent">✓</span>}
            </button>
          ))}
        </FilterDropdown>
      </div>}

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {/* Table Header — hidden on mobile (cards don't need headers) */}
        <div className="sticky top-0 z-10 hidden md:grid grid-cols-[28px_72px_1fr_110px_90px_80px_80px_100px_90px] gap-1.5 border-b border-border bg-bg px-4 md:px-6 py-2 text-[10px] uppercase tracking-wider text-muted font-medium">
          <span />
          <button onClick={() => toggleSort('display_id')} className="text-left hover:text-secondary transition-colors flex items-center">
            {t('list.id')} <SortIcon field="display_id" />
          </button>
          <button onClick={() => toggleSort('title')} className="text-left hover:text-secondary transition-colors flex items-center">
            {t('list.title')} <SortIcon field="title" />
          </button>
          <button onClick={() => toggleSort('status')} className="text-left hover:text-secondary transition-colors flex items-center">
            {t('list.status')} <SortIcon field="status" />
          </button>
          <button onClick={() => toggleSort('priority')} className="text-left hover:text-secondary transition-colors flex items-center">
            {t('list.priority')} <SortIcon field="priority" />
          </button>
          <button onClick={() => toggleSort('type')} className="text-left hover:text-secondary transition-colors flex items-center">
            {t('list.type')} <SortIcon field="type" />
          </button>
          <span>{t('list.tags')}</span>
          <span>{t('list.createdBy') || 'Created by'}</span>
          <span>{t('list.assign')}</span>
        </div>

        {/* Mobile sort controls */}
        <div className="flex md:hidden items-center gap-2 border-b border-border px-3 py-2 overflow-x-auto">
          <span className="text-[10px] text-muted uppercase tracking-wider shrink-0">Sort:</span>
          {(['display_id', 'title', 'status', 'priority', 'updated_at'] as SortField[]).map((field) => (
            <button
              key={field}
              onClick={() => toggleSort(field)}
              className={cn(
                'shrink-0 rounded-md px-2 py-1 text-[10px] uppercase tracking-wider transition-colors',
                sortField === field ? 'bg-surface-hover text-primary font-medium' : 'text-muted hover:text-secondary',
              )}
            >
              {field === 'display_id' ? t('list.id') : field === 'updated_at' ? t('list.updated') : t(`list.${field}`)}
              <SortIcon field={field} />
            </button>
          ))}
        </div>

        {/* Grouped rows */}
        {groupedIssues.map((group) => {
          const isCollapsed = collapsedGroups.has(group.key);

          return (
            <div key={group.key}>
              {/* Group header (hidden for 'none' with single group) */}
              {groupBy !== 'none' && (
                <button
                  onClick={() => toggleGroup(group.key)}
                  className="sticky top-0 md:top-[33px] z-[5] flex w-full items-center gap-2 border-b border-border/50 bg-surface px-3 md:px-6 py-2 text-xs font-medium text-secondary hover:bg-surface transition-colors"
                >
                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  {group.color && <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: group.color }} />}
                  {group.label}
                  <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-muted font-mono">
                    {group.issues.length}
                  </span>
                </button>
              )}

              {!isCollapsed && group.issues.map((issue) => (
                <ListRow
                  key={issue.id}
                  issue={issue}
                  statuses={statuses}
                  projectTags={projectTags}
                  onClick={() => onIssueClick(issue)}
                  onContextMenu={handleContextMenu}
                  selected={selectedIds.has(issue.id)}
                  onSelect={(id, shift) => toggleSelect(id, shift, allIssueIds)}
                />
              ))}
            </div>
          );
        })}

        {sortedIssues.length === 0 && issues.length === 0 && (
          <EmptyState
            icon={Inbox}
            title={t('empty.noIssues')}
            description={t('empty.noIssuesDesc')}
          />
        )}
        {sortedIssues.length === 0 && issues.length > 0 && (
          <EmptyState
            icon={SearchX}
            title={t('empty.noFilterResults')}
            description={t('empty.noFilterResultsDesc')}
            action={{ label: t('kanban.clearAll'), onClick: clearAllFilters }}
          />
        )}
      </div>

      {/* Bulk Action Bar */}
      <BulkActionBar
        selectedIds={selectedIds}
        issues={sortedIssues}
        statuses={statuses}
        onClear={deselectAll}
        onDeselectAll={deselectAll}
        onSelectAll={() => selectAll(allIssueIds)}
        totalCount={sortedIssues.length}
      />

      {/* Context Menu */}
      {contextMenu && (
        <IssueContextMenu
          issue={contextMenu.issue}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          statuses={statuses}
          onClose={() => setContextMenu(null)}
          onStatusChange={handleStatusChange}
          onPriorityChange={handlePriorityChange}
          onDelete={(issue) => setDeleteTarget(issue)}
          onCopyId={handleCopyId}
          onOpen={handleOpen}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <DeleteConfirmModal
          issue={deleteTarget}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

/* ── Filter Dropdown (shared) ──────────────────── */

import { useRef, useEffect } from 'react';

function FilterDropdown({
  icon,
  label,
  count,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors min-h-[32px]',
          count > 0
            ? 'border-accent/30 bg-accent/10 text-accent'
            : 'border-border bg-surface text-secondary hover:border-border hover:text-primary',
        )}
      >
        <span aria-hidden="true">{icon}</span>
        {label}
        {count > 0 && (
          <span className="ml-0.5 rounded-full bg-accent px-1.5 py-0 text-[9px] text-black font-bold" aria-label={`${count} selected`}>
            {count}
          </span>
        )}
        <ChevronDown size={10} aria-hidden="true" />
      </button>
      {open && (
        <div role="listbox" aria-label={label} className="absolute left-0 top-full z-50 mt-1 w-48 rounded-lg border border-border bg-surface py-1 shadow-xl max-h-64 overflow-y-auto">
          {children}
        </div>
      )}
    </div>
  );
}
