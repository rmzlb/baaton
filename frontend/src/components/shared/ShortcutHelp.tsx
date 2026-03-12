import { useTranslation } from '@/hooks/useTranslation';
import { SHORTCUT_DEFS } from '@/hooks/useKeyboardShortcuts';
import { X, Keyboard } from 'lucide-react';
import { cn } from '@/lib/utils';

const GROUP_ICONS: Record<string, string> = {
  'Navigation': '🕹️',
  'Go-To': '📍',
  'Actions': '⚡',
  'Quick Status': '🎯',
  'Quick Priority': '🔥',
  'General': '⌨️',
};

const GROUP_COLORS: Record<string, string> = {
  'Navigation': 'border-blue-500/30 bg-blue-500/5',
  'Go-To': 'border-purple-500/30 bg-purple-500/5',
  'Actions': 'border-amber-500/30 bg-amber-500/5',
  'Quick Status': 'border-emerald-500/30 bg-emerald-500/5',
  'Quick Priority': 'border-red-500/30 bg-red-500/5',
  'General': 'border-border bg-surface/50',
};

function formatKey(key: string): string {
  return key
    .replace('mod', '⌘')
    .replace('shift', '⇧')
    .replace('>', ' → ')
    .replace('Escape', 'ESC');
}

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();

  // Group shortcuts
  const groups = SHORTCUT_DEFS.reduce<Record<string, typeof SHORTCUT_DEFS[number][]>>(
    (acc, def) => {
      (acc[def.group] ??= []).push(def);
      return acc;
    },
    {},
  );

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-border bg-bg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface">
          <div className="flex items-center gap-2">
            <Keyboard size={18} className="text-accent" />
            <h2 className="text-sm font-bold text-primary">
              {t('shortcut.title')}
            </h2>
            <span className="text-[10px] text-muted font-mono bg-surface-hover px-1.5 py-0.5 rounded">
              {SHORTCUT_DEFS.length} {t('shortcut.bindings')}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-muted hover:text-primary hover:bg-surface-hover transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Groups grid */}
        <div className="grid grid-cols-2 gap-3 p-4 max-h-[70vh] overflow-y-auto">
          {Object.entries(groups).map(([group, defs]) => (
            <div
              key={group}
              className={cn(
                'rounded-lg border p-3',
                GROUP_COLORS[group] ?? 'border-border bg-surface/50',
              )}
            >
              <h3 className="text-[11px] font-bold text-primary mb-2 flex items-center gap-1.5">
                <span>{GROUP_ICONS[group] ?? '🎮'}</span>
                {group}
              </h3>
              <div className="space-y-1">
                {defs.map((def) => (
                  <div
                    key={def.keys}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="text-[11px] text-secondary truncate">
                      {t(def.label)}
                    </span>
                    <kbd className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-border/50 bg-bg text-[10px] text-muted font-mono">
                      {formatKey(def.keys)}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-2 border-t border-border text-[10px] text-muted">
          <span>{t('shortcut.footer')}</span>
          <kbd className="px-1.5 py-0.5 rounded border border-border text-[10px] font-mono">
            ESC
          </kbd>
        </div>
      </div>
    </div>
  );
}

export default ShortcutHelp;
