import { X } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

interface ShortcutsModalProps {
  onClose: () => void;
}

const SHORTCUT_GROUPS = [
  {
    titleKey: 'shortcuts.navigation',
    items: [
      { keys: ['g', 'h'], descKey: 'shortcuts.goHome' },
      { keys: ['g', 'i'], descKey: 'shortcuts.goIssues' },
      { keys: ['g', 'm'], descKey: 'shortcuts.goMyTasks' },
      { keys: ['g', 't'], descKey: 'shortcuts.goTable' },
      { keys: ['g', 's'], descKey: 'shortcuts.goSettings' },
    ],
  },
  {
    titleKey: 'shortcuts.actions',
    items: [
      { keys: ['c'], descKey: 'shortcuts.createIssue' },
      { keys: ['/'], descKey: 'shortcuts.focusSearch' },
      { keys: ['?'], descKey: 'shortcuts.showHelp' },
    ],
  },
  {
    titleKey: 'shortcuts.general',
    items: [
      { keys: ['Esc'], descKey: 'shortcuts.close' },
    ],
  },
];

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-md border border-border bg-bg text-xs font-mono font-medium text-secondary">
      {children}
    </kbd>
  );
}

export function ShortcutsModal({ onClose }: ShortcutsModalProps) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-primary">{t('shortcuts.title')}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-primary transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="px-6 py-5 space-y-6 max-h-[60vh] overflow-y-auto">
          {SHORTCUT_GROUPS.map(group => (
            <div key={group.titleKey}>
              <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">
                {t(group.titleKey as any)}
              </h3>
              <div className="space-y-2">
                {group.items.map(item => (
                  <div key={item.descKey} className="flex items-center justify-between py-1.5">
                    <span className="text-sm text-secondary">{t(item.descKey as any)}</span>
                    <div className="flex items-center gap-1">
                      {item.keys.map((k, i) => (
                        <span key={i} className="flex items-center gap-1">
                          {i > 0 && <span className="text-muted text-xs">then</span>}
                          <Kbd>{k}</Kbd>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default ShortcutsModal;
