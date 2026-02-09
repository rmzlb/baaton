import { useHotkeys } from 'react-hotkeys-hook';
import { useIssuesStore } from '@/stores/issues';

/**
 * All shortcut definitions — exported for use by ShortcutHelp overlay.
 */
export const SHORTCUT_DEFS = [
  { keys: 'j', label: 'Next issue' },
  { keys: 'k', label: 'Previous issue' },
  { keys: 'e', label: 'Open selected issue' },
  { keys: 'n', label: 'New issue' },
  { keys: 'Escape', label: 'Close drawer / modal' },
  { keys: 'shift+/', label: 'Show keyboard shortcuts' },
] as const;

interface UseKeyboardShortcutsOptions {
  /** All issue IDs in display order */
  issueIds: string[];
  /** Callback to open the "create issue" modal */
  onNewIssue: () => void;
  /** Callback to toggle the shortcut help overlay */
  onToggleHelp: () => void;
}

/**
 * Registers global keyboard shortcuts for issue navigation and actions.
 * Must be called inside a component that has access to the issue list.
 */
export function useKeyboardShortcuts({
  issueIds,
  onNewIssue,
  onToggleHelp,
}: UseKeyboardShortcutsOptions) {
  const selectedIssueId = useIssuesStore((s) => s.selectedIssueId);
  const isDetailOpen = useIssuesStore((s) => s.isDetailOpen);
  const openDetail = useIssuesStore((s) => s.openDetail);
  const closeDetail = useIssuesStore((s) => s.closeDetail);
  const selectIssue = useIssuesStore((s) => s.selectIssue);

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
