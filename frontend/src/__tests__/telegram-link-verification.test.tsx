import { act, renderHook, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTelegramLinkVerification, telegramDestinationFingerprint } from '@/hooks/useTelegramLinkVerification';
import type { UserNotificationChannel } from '@/lib/types';

const listChannels = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useApi', () => ({ useApi: () => ({ notificationPrefs: {
  cacheScope: ['notif-prefs', 'user-test'], listChannels,
} }) }));
const verified: UserNotificationChannel = {
  channel: 'telegram', address_masked: '***1234', verified: true,
  created_at: '2026-09-15T00:00:01Z', telegram_thread_id: null,
  telegram_bot_username: 'test_bot',
};
let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-15T00:00:00Z'));
  listChannels.mockReset(); listChannels.mockResolvedValue([]);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); vi.useRealTimers(); });
const props = () => ({ active: true, expiresAt: '2026-09-15T00:15:00Z', baseline: null as string | null, onVerified: vi.fn() });

describe('Telegram verification against the real hook', () => {
  it('does not poll before a link is issued', async () => {
    renderHook(() => useTelegramLinkVerification({ ...props(), active: false }), { wrapper });
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(listChannels).not.toHaveBeenCalled();
  });
  it('auto-updates the channel cache after /start and stops polling', async () => {
    const p = props(); listChannels.mockResolvedValueOnce([]).mockResolvedValueOnce([verified]);
    renderHook(() => useTelegramLinkVerification(p), { wrapper });
    await act(() => vi.advanceTimersByTimeAsync(3_100));
    expect(p.onVerified).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(['notif-prefs','user-test','channels'])).toEqual([verified]);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(listChannels).toHaveBeenCalledTimes(2);
  });
  it('does not mistake the old verified destination for a completed reconnect', async () => {
    const p = { ...props(), baseline: telegramDestinationFingerprint([verified]) };
    listChannels.mockResolvedValue([verified]);
    renderHook(() => useTelegramLinkVerification(p), { wrapper });
    await act(() => vi.advanceTimersByTimeAsync(3_100));
    expect(p.onVerified).not.toHaveBeenCalled();
    listChannels.mockResolvedValue([{ ...verified, created_at: '2026-09-15T00:00:06Z' }]);
    await act(() => vi.advanceTimersByTimeAsync(3_100));
    expect(p.onVerified).toHaveBeenCalledOnce();
  });
  it('uses the real link expiry and stops after expiration', async () => {
    const p = { ...props(), expiresAt: '2026-09-15T00:00:05Z' };
    const { result } = renderHook(() => useTelegramLinkVerification(p), { wrapper });
    await act(() => vi.advanceTimersByTimeAsync(5_100));
    expect(result.current).toBe(true);
    const count = listChannels.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(listChannels).toHaveBeenCalledTimes(count);
  });
  it('refreshes on returning from Telegram and recovers a temporary network error', async () => {
    const p = props(); listChannels.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([verified]);
    renderHook(() => useTelegramLinkVerification(p), { wrapper });
    await act(() => vi.advanceTimersByTimeAsync(1));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(p.onVerified).toHaveBeenCalledOnce();
  });
  it('ignores an in-flight response after unmount', async () => {
    const p = props(); let resolve!: (v: UserNotificationChannel[]) => void;
    listChannels.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { unmount } = renderHook(() => useTelegramLinkVerification(p), { wrapper });
    unmount(); await act(async () => { resolve([verified]); });
    expect(p.onVerified).not.toHaveBeenCalled();
  });
});
