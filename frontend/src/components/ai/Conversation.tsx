import { cn } from '@/lib/utils';

export function Conversation({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-border bg-bg shadow-sm',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ConversationHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="border-b border-border px-4 py-3 bg-surface">
      <div className="text-xs font-semibold text-primary">{title}</div>
      {subtitle && <div className="text-[10px] text-muted mt-0.5">{subtitle}</div>}
    </div>
  );
}

export function ConversationBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('p-3 space-y-3', className)}>{children}</div>;
}

export function ConversationFooter({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('border-t border-border px-3 py-2.5', className)}>{children}</div>;
}
