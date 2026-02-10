import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { SHORTCUT_DEFS } from '@/hooks/useKeyboardShortcuts';

interface ShortcutHelpProps {
  onClose: () => void;
}

/** Pretty-print a key combo */
function formatKey(keys: string): string[] {
  // Handle sequence keys like "g>m" (sequence separator)
  if (keys.includes('>')) {
    return keys.split('>').map((k) => k.toUpperCase());
  }
  return keys.split('+').map((k) => {
    if (k === 'shift') return '⇧';
    if (k === '/') return '?';
    if (k === 'Escape') return 'Esc';
    return k.toUpperCase();
  });
}

export function ShortcutHelp({ onClose }: ShortcutHelpProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        ref={panelRef}
        className="w-full max-w-sm rounded-xl border border-border bg-bg shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-primary">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-secondary hover:bg-surface-hover hover:text-primary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Shortcuts list */}
        <div className="p-4 space-y-2">
          {SHORTCUT_DEFS.map(({ keys, label }) => (
            <div key={keys} className="flex items-center justify-between py-1">
              <span className="text-xs text-secondary">{label}</span>
              <div className="flex items-center gap-1">
                {formatKey(keys).map((k, i) => (
                  <kbd
                    key={i}
                    className="inline-flex min-w-[24px] items-center justify-center rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px] font-mono font-medium text-primary shadow-sm"
                  >
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-4 py-2.5">
          <p className="text-[10px] text-muted text-center">
            Press <kbd className="inline-flex items-center rounded border border-border bg-surface px-1 py-0.5 text-[9px] font-mono">Esc</kbd> to close
          </p>
        </div>
      </div>
    </div>
  );
}

export default ShortcutHelp;
