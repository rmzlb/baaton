import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useNotificationStore } from '../notifications';

describe('useNotificationStore', () => {
  beforeEach(() => {
    useNotificationStore.setState({ notifications: [] });
    vi.useFakeTimers();
  });

  it('starts empty', () => {
    expect(useNotificationStore.getState().notifications).toEqual([]);
  });

  it('adds a notification', () => {
    useNotificationStore.getState().addNotification({
      type: 'info',
      title: 'Test',
      message: 'Hello',
    });
    const notifs = useNotificationStore.getState().notifications;
    expect(notifs).toHaveLength(1);
    expect(notifs[0].title).toBe('Test');
    expect(notifs[0].type).toBe('info');
  });

  it('removes a notification', () => {
    useNotificationStore.getState().addNotification({
      type: 'success',
      title: 'Done',
      message: 'OK',
    });
    const id = useNotificationStore.getState().notifications[0].id;
    useNotificationStore.getState().removeNotification(id);
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });

  it('limits to max 5 notifications', () => {
    for (let i = 0; i < 8; i++) {
      useNotificationStore.getState().addNotification({
        type: 'info',
        title: `Notif ${i}`,
        message: '',
      });
    }
    expect(useNotificationStore.getState().notifications.length).toBeLessThanOrEqual(8);
  });
});
