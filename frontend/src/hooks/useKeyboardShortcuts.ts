import { useHotkeys } from 'react-hotkeys-hook';
import { useNavigate, useLocation } from 'react-router-dom';
import { useIssuesStore } from '@/stores/issues';

/**
 * All shortcut definitions — exported for use by ShortcutHelp overlay.
 */
export const SHORTCUT_DEFS = [
  // Navigation
  { keys: 'j', label: 'Next issue', group: 'Navigation' },
  { keys: 'k', label: 'Previous issue', group: 'Navigation' },
  { keys: 'e', label: 'Open selected issue', group: 'Navigation' },
  { keys: 'g>p', label: 'Go to projects', group: 'Navigation' },
  { keys: 'g>d', label: 'Go to dashboard', group: 'Navigation' },
  { keys: 'g>t', label: 'Go to triage', group: 'Navigation' },
  { keys: 'g>m', label: 'Go to milestones', group: 'Navigation' },
  { keys: 'g>a', label: 'Go to analytics', group: 'Navigation' },
  { keys: 'g>s', label: 'Go to search', group: 'Navigation' },
  // Actions
  { keys: 'n', label: 'New issue', group: 'Actions' },
  { keys: 'shift+m', label: 'Assign milestone', group: 'Actions' },
  { keys: 'mod+k', label: 'Command palette', group: 'Actions' },
  // General
  { keys: 'Escape', label: 'Close drawer / modal', group: 'General' },
  { keys: 'shift+/', label: 'Show keyboard shortcuts', group: 'General' },
] as const;

interface UseKeyboardShortcutsOptions {
  /** All issue IDs in display order */
  issueIds: string[];
  /** Callback to open the "create issue" modal */
  onNewIssue: () => void;
  /** Callback to toggle the shortcut help overlay */
  onToggleHelp: () => void;
  /** Callback to open the milestone picker for the selected issue */
  onAssignMilestone?: () => void;
}

/**
 * Registers global keyboard shortcuts for issue navigation and actions.
 * Must be called inside a component that has access to the issue list.
 */
export function useKeyboardShortcuts({
  issueIds,
  onNewIssue,
  onToggleHelp,
  onAssignMilestone,
}: UseKeyboardShortcutsOptions) {
  const selectedIssueId = useIssuesStore((s) => s.selectedIssueId);
  const isDetailOpen = useIssuesStore((s) => s.isDetailOpen);
  const openDetail = useIssuesStore((s) => s.openDetail);
  const closeDetail = useIssuesStore((s) => s.closeDetail);
  const selectIssue = useIssuesStore((s) => s.selectIssue);
  const navigate = useNavigate();
  const location = useLocation();

  // J — next issue
  useHotkeys(
    'j',
    () => {
      if (issueIds.length === 0) return;
      const currentIdx = selectedIssueId ? issueIds.indexOf(selectedIssueId) : -1;
      const nextIdx = Math.min(currentIdx + 1, issueIds.length - 1);
      const nextId = issueIds[nextIdx];
      if (nextId) {
        if (isDetailOpen) {
          openDetail(nextId);
        } else {
          selectIssue(nextId);
        }
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
        if (isDetailOpen) {
          openDetail(prevId);
        } else {
          selectIssue(prevId);
        }
      }
    },
    { enabled: issueIds.length > 0, preventDefault: true },
    [issueIds, selectedIssueId, isDetailOpen],
  );

  // E — edit (open drawer for selected issue)
  useHotkeys(
    'e',
    () => {
      if (selectedIssueId && !isDetailOpen) {
        openDetail(selectedIssueId);
      }
    },
    { enabled: !!selectedIssueId && !isDetailOpen, preventDefault: true },
    [selectedIssueId, isDetailOpen],
  );

  // N — new issue
  useHotkeys(
    'n',
    () => {
      onNewIssue();
    },
    { preventDefault: true },
    [onNewIssue],
  );

  // Shift+M — assign milestone to selected issue
  useHotkeys(
    'shift+m',
    () => {
      if (onAssignMilestone) {
        onAssignMilestone();
      }
    },
    { enabled: !!onAssignMilestone, preventDefault: true },
    [onAssignMilestone],
  );

  // G then M — go to milestones page
  useHotkeys(
    'g>m',
    () => {
      const match = location.pathname.match(/^\/projects\/([^/]+)/);
      if (match) {
        navigate(`/projects/${match[1]}/milestones`);
      }
    },
    { preventDefault: true },
    [location.pathname, navigate],
  );

  // G then P — go to projects
  useHotkeys('g>p', () => navigate('/projects'), { preventDefault: true }, [navigate]);

  // G then D — go to dashboard
  useHotkeys('g>d', () => navigate('/dashboard'), { preventDefault: true }, [navigate]);

  // G then T — go to triage
  useHotkeys('g>t', () => navigate('/triage'), { preventDefault: true }, [navigate]);

  // G then A — go to analytics
  useHotkeys('g>a', () => navigate('/analytics'), { preventDefault: true }, [navigate]);

  // G then S — go to search
  useHotkeys('g>s', () => navigate('/search'), { preventDefault: true }, [navigate]);

  // Escape — close drawer/modal
  useHotkeys(
    'Escape',
    () => {
      if (isDetailOpen) {
        closeDetail();
      }
    },
    { enabled: isDetailOpen },
    [isDetailOpen],
  );

  // ? (shift+/) — show shortcut help
  useHotkeys(
    'shift+/',
    () => {
      onToggleHelp();
    },
    { preventDefault: true },
    [onToggleHelp],
  );
}
