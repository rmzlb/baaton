import { create } from 'zustand';

export interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning';
  title: string;
  message: string;
  createdAt: number;
}

interface NotificationState {
  notifications: Notification[];
  addNotification: (n: Omit<Notification, 'id' | 'createdAt'>) => void;
  removeNotification: (id: string) => void;
  clearAll: () => void;
}

let nextId = 0;

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],

  addNotification: (n) => {
    const id = `notif-${++nextId}-${Date.now()}`;
    set((s) => ({
      notifications: [
        ...s.notifications,
        { ...n, id, createdAt: Date.now() },
      ],
    }));
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      set((s) => ({
        notifications: s.notifications.filter((x) => x.id !== id),
      }));
    }, 5000);
  },

  removeNotification: (id) =>
    set((s) => ({
      notifications: s.notifications.filter((x) => x.id !== id),
    })),

  clearAll: () => set({ notifications: [] }),
}));
