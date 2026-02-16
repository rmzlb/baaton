import { useUser } from '@clerk/clerk-react';
import { Inbox } from '@novu/react';
import { Bell } from 'lucide-react';

const NOVU_APP_ID = import.meta.env.VITE_NOVU_APP_ID as string | undefined;
const NOVU_BACKEND_URL = import.meta.env.VITE_NOVU_BACKEND_URL as string | undefined;
const NOVU_SOCKET_URL = import.meta.env.VITE_NOVU_SOCKET_URL as string | undefined;

export function NotificationBell() {
  const { user, isLoaded } = useUser();

  if (!isLoaded || !user || !NOVU_APP_ID) return null;

  return (
    <Inbox
      applicationIdentifier={NOVU_APP_ID}
      subscriberId={user.id}
      backendUrl={NOVU_BACKEND_URL}
      socketUrl={NOVU_SOCKET_URL}
      placement="bottom-end"
      renderBell={(unreadCount) => {
        const count = unreadCount.total;
        return (
          <button
            aria-label={`Notifications${count > 0 ? ` (${count} unread)` : ''}`}
            className="relative flex items-center justify-center rounded-lg p-1.5 text-secondary hover:bg-surface hover:text-primary transition-colors"
          >
            <Bell size={16} />
            {count > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-black">
                {count > 99 ? '99+' : count}
              </span>
            )}
          </button>
        );
      }}
      appearance={{
        elements: {
          popoverContent: 'bg-surface border border-border rounded-xl shadow-2xl shadow-black/20',
          notificationListContainer: 'bg-surface',
          notification: 'bg-surface hover:bg-surface-hover border-b border-border text-primary',
          notificationSubject: 'text-primary text-sm',
          notificationBody: 'text-secondary text-xs',
          notificationDate: 'text-muted text-xs',
          bellContainer: 'h-auto w-auto',
        },
      }}
    />
  );
}
