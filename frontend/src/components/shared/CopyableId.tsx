import { useState, useCallback } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CopyableIdProps {
  id: string;
  className?: string;
  iconSize?: number;
}

/**
 * Clickable issue ID that copies to clipboard on click.
 * Shows a brief ✓ check animation after copy.
 */
export function CopyableId({ id, className, iconSize = 10 }: CopyableIdProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    navigator.clipboard.writeText(id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [id]);

  return (
    <button
      onClick={handleCopy}
      title={`Copy ${id}`}
      className={cn(
        'inline-flex items-center gap-1 font-mono cursor-pointer rounded px-0.5 -mx-0.5 transition-colors hover:bg-accent/10 hover:text-accent group/cid',
        className,
      )}
    >
      {id}
      {copied ? (
        <Check size={iconSize} className="text-emerald-500 shrink-0" />
      ) : (
        <Copy size={iconSize} className="opacity-0 group-hover/cid:opacity-60 shrink-0 transition-opacity" />
      )}
    </button>
  );
}
