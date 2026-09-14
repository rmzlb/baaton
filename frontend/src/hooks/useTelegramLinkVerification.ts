import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import type { UserNotificationChannel } from '@/lib/types';

export function telegramDestinationFingerprint(channels: UserNotificationChannel[]): string | null {
  const channel = channels.find((c) => c.channel === 'telegram' && c.verified);
  return channel ? JSON.stringify([
    channel.created_at, channel.address_masked,
    channel.telegram_thread_id, channel.telegram_bot_username,
  ]) : null;
}

/** Poll only during an issued link's lifetime; reconnect must observe a NEW verification. */
export function useTelegramLinkVerification({ active, expiresAt, baseline, onVerified }: {
  active: boolean;
  expiresAt: string | null;
  baseline: string | null;
  onVerified: () => void;
}): boolean {
  const api = useApi();
  const client = useQueryClient();
  const callback = useRef(onVerified);
  const apiRef = useRef(api);
  callback.current = onVerified;
  apiRef.current = api;
  const [expired, setExpired] = useState(false);
  const scope = JSON.stringify(api.notificationPrefs.cacheScope);

  useEffect(() => {
    setExpired(false);
    if (!active || !expiresAt) return;
    const deadline = Date.parse(expiresAt);
    if (!Number.isFinite(deadline) || Date.now() >= deadline) {
      setExpired(true);
      return;
    }
    let cancelled = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiryTimer = setTimeout(() => {
      cancelled = true;
      clearTimeout(timer);
      setExpired(true);
    }, deadline - Date.now());

    const check = async () => {
      if (cancelled || inFlight || Date.now() >= deadline) return;
      inFlight = true;
      clearTimeout(timer);
      try {
        const channels = await apiRef.current.notificationPrefs.listChannels();
        if (cancelled || Date.now() >= deadline) return;
        const fingerprint = telegramDestinationFingerprint(channels);
        if (fingerprint && fingerprint !== baseline) {
          cancelled = true;
          clearTimeout(expiryTimer);
          client.setQueryData([...JSON.parse(scope), 'channels'], channels);
          callback.current();
          return;
        }
      } catch {
        // A temporary network failure is not a failed Telegram verification.
      } finally {
        inFlight = false;
        if (!cancelled && Date.now() < deadline) timer = setTimeout(check, 3_000);
      }
    };
    const onFocus = () => { void check(); };
    window.addEventListener('focus', onFocus);
    void check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(expiryTimer);
      window.removeEventListener('focus', onFocus);
    };
  }, [active, expiresAt, baseline, scope, client]);
  return expired;
}
