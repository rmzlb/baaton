import { useHotkeys } from 'react-hotkeys-hook';
import { useNavigate, useLocation } from 'react-router-dom';
import { useIssuesStore } from '@/stores/issues';

/**
 * All shortcut definitions — exported for use by ShortcutHelp overlay.
 * Grouped like a game control scheme: Navigation, Actions, Go-To, Quick Status, General.
 */
export const SHORTCUT_DEFS = [
  // ─── Navigation (Vim-like) ───
  { keys: 'j', label: 'shortcut.nextIssue', group: 'Navigation' },
  { keys: 'k', label: 'shortcut.prevIssue', group: 'Navigation' },
  { keys: 'e', label: 'shortcut.openIssue', group: 'Navigation' },
  { keys: 'x', label: 'shortcut.selectToggle', group: 'Navigation' },
  { keys: 'shift+j', label: 'shortcut.nextProject', group: 'Navigation' },
  { keys: 'shift+k', label: 'shortcut.prevProject', group: 'Navigation' },

  // ─── Go-To (g + key) — like StarCraft camera hotkeys ───
  { keys: 'g>p', label: 'shortcut.goProjects', group: 'Go-To' },
  { keys: 'g>d', label: 'shortcut.goDashboard', group: 'Go-To' },
  { keys: 'g>t', label: 'shortcut.goTriage', group: 'Go-To' },
  { keys: 'g>m', label: 'shortcut.goMilestones', group: 'Go-To' },
  { keys: 'g>a', label: 'shortcut.goAnalytics', group: 'Go-To' },
  { keys: 'g>s', label: 'shortcut.goSearch', group: 'Go-To' },
  { keys: 'g>b', label: 'shortcut.goBilling', group: 'Go-To' },
  { keys: 'g>i', label: 'shortcut.goAI', group: 'Go-To' },
  { keys: 'g>w', label: 'shortcut.goWebhooks', group: 'Go-To' },
  { keys: 'g>r', label: 'shortcut.goAutomations', group: 'Go-To' },

  // ─── Quick Actions (like ability keys) ───
  { keys: 'n', label: 'shortcut.newIssue', group: 'Actions' },
  { keys: 'c', label: 'shortcut.commentIssue', group: 'Actions' },
  { keys: 'l', label: 'shortcut.labelIssue', group: 'Actions' },
  { keys: 'a', label: 'shortcut.assignIssue', group: 'Actions' },
  { keys: 'shift+m', label: 'shortcut.milestoneIssue', group: 'Actions' },
  { keys: 'mod+k', label: 'shortcut.commandPalette', group: 'Actions' },

  // ─── Quick Status (1-4 — like item slots) ───
  { keys: '1', label: 'shortcut.statusBacklog', group: 'Quick Status' },
  { keys: '2', label: 'shortcut.statusTodo', group: 'Quick Status' },
  { keys: '3', label: 'shortcut.statusProgress', group: 'Quick Status' },
  { keys: '4', label: 'shortcut.statusDone', group: 'Quick Status' },

  // ─── Quick Priority (shift+1-4 — like Valorant buy binds) ───
  { keys: 'shift+1', label: 'shortcut.prioUrgent', group: 'Quick Priority' },
  { keys: 'shift+2', label: 'shortcut.prioHigh', group: 'Quick Priority' },
  { keys: 'shift+3', label: 'shortcut.prioMedium', group: 'Quick Priority' },
  { keys: 'shift+4', label: 'shortcut.prioLow', group: 'Quick Priority' },

  // ─── General ───
  { keys: 'Escape', label: 'shortcut.close', group: 'General' },
  { keys: 'shift+/', label: 'shortcut.showHelp', group: 'General' },
  { keys: 'f', label: 'shortcut.toggleFilter', group: 'General' },
  { keys: 'r', label: 'shortcut.refresh', group: 'General' },
] as const;

interface UseKeyboardShortcutsOptions {
  issueIds: string[];
  onNewIssue: () => void;
  onToggleHelp: () => void;
  onAssignMilestone?: () => void;
  /** Quick status change on selected issue */
  onSetStatus?: (status: string) => void;
  /** Quick priority change on selected issue */
  onSetPriority?: (priority: string) => void;
  /** Open comment box on selected issue */
  onComment?: () => void;
  /** Open label picker */
  onLabel?: () => void;
  /** Open assignee picker */
  onAssign?: () => void;
  /** Toggle filter panel */
  onToggleFilter?: () => void;
  /** Refresh data */
  onRefresh?: () => void;
  /** Navigate to next/prev project */
  projectSlugs?: string[];
}

export function useKeyboardShortcuts({
  issueIds,
  onNewIssue,
  onToggleHelp,
  onAssignMilestone,
  onSetStatus,
  onSetPriority,
  onComment,
  onLabel,
  onAssign,
  onToggleFilter,
  onRefresh,
  projectSlugs,
}: UseKeyboardShortcutsOptions) {
  const selectedIssueId = useIssuesStore((s) => s.selectedIssueId);
  const isDetailOpen = useIssuesStore((s) => s.isDetailOpen);
  const openDetail = useIssuesStore((s) => s.openDetail);
  const closeDetail = useIssuesStore((s) => s.closeDetail);
  const selectIssue = useIssuesStore((s) => s.selectIssue);
  const navigate = useNavigate();
  const location = useLocation();

  // ─── Navigation ───

  // J — next issue
  useHotkeys(
    'j',
    () => {
      if (issueIds.length === 0) return;
      const currentIdx = selectedIssueId ? issueIds.indexOf(selectedIssueId) : -1;
      const nextIdx = Math.min(currentIdx + 1, issueIds.length - 1);
      const nextId = issueIds[nextIdx];
      if (nextId) {
        if (isDetailOpen) openDetail(nextId);
        else selectIssue(nextId);
      }
    },
    { enabled: issueIds.length > 0, preventDefault: true },
    [issueIds, selectedIssueId, isDetailOpen],
  );

  // K — previous issue
  useHotkeys(
    'k',
    () => {
      if (issueIds.length === 0) return;
      const currentIdx = selectedIssueId ? issueIds.indexOf(selectedIssueId) : issueIds.length;
      const prevIdx = Math.max(currentIdx - 1, 0);
      const prevId = issueIds[prevIdx];
      if (prevId) {
        if (isDetailOpen) openDetail(prevId);
        else selectIssue(prevId);
      }
    },
    { enabled: issueIds.length > 0, preventDefault: true },
    [issueIds, selectedIssueId, isDetailOpen],
  );

  // E — edit (open drawer for selected issue)
  useHotkeys(
    'e',
    () => {
      if (selectedIssueId && !isDetailOpen) openDetail(selectedIssueId);
    },
    { enabled: !!selectedIssueId && !isDetailOpen, preventDefault: true },
    [selectedIssueId, isDetailOpen],
  );

  // Shift+J / Shift+K — next/prev project
  useHotkeys(
    'shift+j',
    () => {
      if (!projectSlugs?.length) return;
      const match = location.pathname.match(/^\/projects\/([^/]+)/);
      const currentSlug = match?.[1] ?? '';
      const idx = projectSlugs.indexOf(currentSlug);
      const nextSlug = projectSlugs[Math.min(idx + 1, projectSlugs.length - 1)];
      if (nextSlug) navigate(`/projects/${nextSlug}`);
    },
    { enabled: !!projectSlugs?.length, preventDefault: true },
    [projectSlugs, location.pathname],
  );

  useHotkeys(
    'shift+k',
    () => {
      if (!projectSlugs?.length) return;
      const match = location.pathname.match(/^\/projects\/([^/]+)/);
      const currentSlug = match?.[1] ?? '';
      const idx = projectSlugs.indexOf(currentSlug);
      const prevSlug = projectSlugs[Math.max(idx - 1, 0)];
      if (prevSlug) navigate(`/projects/${prevSlug}`);
    },
    { enabled: !!projectSlugs?.length, preventDefault: true },
    [projectSlugs, location.pathname],
  );

  // ─── Quick Actions ───

  // N — new issue
  useHotkeys('n', () => onNewIssue(), { preventDefault: true }, [onNewIssue]);

  // C — comment on selected issue
  useHotkeys(
    'c',
    () => { if (onComment) onComment(); },
    { enabled: !!selectedIssueId && !!onComment, preventDefault: true },
    [onComment, selectedIssueId],
  );

  // L — label picker
  useHotkeys(
    'l',
    () => { if (onLabel) onLabel(); },
    { enabled: !!selectedIssueId && !!onLabel, preventDefault: true },
    [onLabel, selectedIssueId],
  );

  // A — assign
  useHotkeys(
    'a',
    () => { if (onAssign) onAssign(); },
    { enabled: !!selectedIssueId && !!onAssign, preventDefault: true },
    [onAssign, selectedIssueId],
  );

  // Shift+M — assign milestone to selected issue
  useHotkeys(
    'shift+m',
    () => { if (onAssignMilestone) onAssignMilestone(); },
    { enabled: !!onAssignMilestone, preventDefault: true },
    [onAssignMilestone],
  );

  // F — toggle filter panel
  useHotkeys(
    'f',
    () => { if (onToggleFilter) onToggleFilter(); },
    { enabled: !!onToggleFilter, preventDefault: true },
    [onToggleFilter],
  );

  // R — refresh
  useHotkeys(
    'r',
    () => { if (onRefresh) onRefresh(); },
    { enabled: !!onRefresh, preventDefault: true },
    [onRefresh],
  );

  // ─── Quick Status (1-4) — like item slots ───
  useHotkeys('1', () => { if (onSetStatus && selectedIssueId) onSetStatus('backlog'); },
    { enabled: !!selectedIssueId && !!onSetStatus, preventDefault: true }, [onSetStatus, selectedIssueId]);
  useHotkeys('2', () => { if (onSetStatus && selectedIssueId) onSetStatus('todo'); },
    { enabled: !!selectedIssueId && !!onSetStatus, preventDefault: true }, [onSetStatus, selectedIssueId]);
  useHotkeys('3', () => { if (onSetStatus && selectedIssueId) onSetStatus('in_progress'); },
    { enabled: !!selectedIssueId && !!onSetStatus, preventDefault: true }, [onSetStatus, selectedIssueId]);
  useHotkeys('4', () => { if (onSetStatus && selectedIssueId) onSetStatus('done'); },
    { enabled: !!selectedIssueId && !!onSetStatus, preventDefault: true }, [onSetStatus, selectedIssueId]);

  // ─── Quick Priority (Shift+1-4) — like buy binds ───
  useHotkeys('shift+1', () => { if (onSetPriority && selectedIssueId) onSetPriority('urgent'); },
    { enabled: !!selectedIssueId && !!onSetPriority, preventDefault: true }, [onSetPriority, selectedIssueId]);
  useHotkeys('shift+2', () => { if (onSetPriority && selectedIssueId) onSetPriority('high'); },
    { enabled: !!selectedIssueId && !!onSetPriority, preventDefault: true }, [onSetPriority, selectedIssueId]);
  useHotkeys('shift+3', () => { if (onSetPriority && selectedIssueId) onSetPriority('medium'); },
    { enabled: !!selectedIssueId && !!onSetPriority, preventDefault: true }, [onSetPriority, selectedIssueId]);
  useHotkeys('shift+4', () => { if (onSetPriority && selectedIssueId) onSetPriority('low'); },
    { enabled: !!selectedIssueId && !!onSetPriority, preventDefault: true }, [onSetPriority, selectedIssueId]);

  // ─── Go-To (g + key) — StarCraft camera location hotkeys ───
  useHotkeys('g>p', () => navigate('/projects'), { preventDefault: true }, [navigate]);
  useHotkeys('g>d', () => navigate('/dashboard'), { preventDefault: true }, [navigate]);
  useHotkeys('g>t', () => navigate('/triage'), { preventDefault: true }, [navigate]);
  useHotkeys('g>a', () => navigate('/analytics'), { preventDefault: true }, [navigate]);
  useHotkeys('g>s', () => navigate('/search'), { preventDefault: true }, [navigate]);
  useHotkeys('g>b', () => navigate('/billing'), { preventDefault: true }, [navigate]);
  useHotkeys('g>i', () => navigate('/ai'), { preventDefault: true }, [navigate]);
  useHotkeys('g>w', () => navigate('/webhooks'), { preventDefault: true }, [navigate]);
  useHotkeys('g>r', () => navigate('/automations'), { preventDefault: true }, [navigate]);

  // G then M — go to milestones (project-aware)
  useHotkeys(
    'g>m',
    () => {
      const match = location.pathname.match(/^\/projects\/([^/]+)/);
      if (match) navigate(`/projects/${match[1]}/milestones`);
    },
    { preventDefault: true },
    [location.pathname, navigate],
  );

  // ─── General ───

  // Escape — close drawer/modal
  useHotkeys(
    'Escape',
    () => { if (isDetailOpen) closeDetail(); },
    { enabled: isDetailOpen },
    [isDetailOpen],
  );

  // ? (shift+/) — show shortcut help
  useHotkeys('shift+/', () => onToggleHelp(), { preventDefault: true }, [onToggleHelp]);
}
