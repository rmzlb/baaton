import { X, Info, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useNotificationStore, type Notification } from '@/stores/notifications';
import { cn } from '@/lib/utils';

const ICON_MAP = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
} as const;

const COLOR_MAP = {
  info: 'border-blue-500/30 bg-blue-500/10',
  success: 'border-green-500/30 bg-green-500/10',
  warning: 'border-amber-500/30 bg-amber-500/10',
} as const;

const ICON_COLOR_MAP = {
  info: 'text-blue-400',
  success: 'text-green-400',
  warning: 'text-amber-400',
} as const;

function ToastItem({ notification }: { notification: Notification }) {
  const removeNotification = useNotificationStore((s) => s.removeNotification);
  const Icon = ICON_MAP[notification.type];

  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 shadow-lg backdrop-blur-sm',
        'animate-slide-in-right min-w-[280px] max-w-[380px]',
        COLOR_MAP[notification.type],
      )}
    >
      <Icon size={16} className={cn('mt-0.5 shrink-0', ICON_COLOR_MAP[notification.type])} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-primary">{notification.title}</p>
        {notification.message && (
          <p className="text-[11px] text-secondary mt-0.5 truncate">{notification.message}</p>
        )}
      </div>
      <button
        onClick={() => removeNotification(notification.id)}
        className="shrink-0 rounded-md p-0.5 text-muted hover:text-primary transition-colors"
      >
        <X size={12} />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const notifications = useNotificationStore((s) => s.notifications);

  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2">
      {notifications.map((n) => (
        <ToastItem key={n.id} notification={n} />
      ))}
    </div>
  );
}
