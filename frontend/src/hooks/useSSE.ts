import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth, useUser } from '@clerk/clerk-react';
import { useNotificationStore } from '@/stores/notifications';
import type { SSEEvent } from '@/lib/types';

import { resolveApiOrigin } from '@/lib/api-origin';
const API_URL = resolveApiOrigin();

/**
 * Global SSE hook — connects to the backend event stream and:
 * 1. Invalidates relevant TanStack Query caches on changes
 * 2. Shows toast notifications for relevant events
 *
 * Should be called once in the app layout.
 */
export function useSSE() {
  const queryClient = useQueryClient();
  const { getToken } = useAuth();
  const { user } = useUser();
  const addNotification = useNotificationStore((s) => s.addNotification);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    const connect = async () => {
      try {
        const token = await getToken({ template: 'default' }).catch(() => null);
        if (!token || cancelled) return;

        // Close existing connection
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
        }

        // EventSource doesn't support Authorization headers,
        // so we pass the token as a query param
        const url = `${API_URL}/api/v1/events?token=${token}`;
        const es = new EventSource(url);
        eventSourceRef.current = es;

        es.onmessage = (event) => {
          if (cancelled) return;

          try {
            const data: SSEEvent = JSON.parse(event.data);

            // ── Invalidate queries ──
            if (data.type === 'issue_created' || data.type === 'issue_updated') {
              queryClient.invalidateQueries({ queryKey: ['issues'] });
              queryClient.invalidateQueries({ queryKey: ['all-issues'] });
              if (data.issue_id) {
                queryClient.invalidateQueries({ queryKey: ['issue', data.issue_id] });
              }
              if (data.project_id) {
                queryClient.invalidateQueries({
                  queryKey: ['issues', data.project_id],
                  exact: false,
                });
              }
              // Invalidate activity feeds
              queryClient.invalidateQueries({ queryKey: ['activity'] });
              if (data.issue_id) {
                queryClient.invalidateQueries({ queryKey: ['activity', data.issue_id] });
              }
            }

            if (data.type === 'comment_created') {
              if (data.issue_id) {
                queryClient.invalidateQueries({ queryKey: ['issue', data.issue_id] });
                queryClient.invalidateQueries({ queryKey: ['activity', data.issue_id] });
              }
              queryClient.invalidateQueries({ queryKey: ['activity'] });
            }

            // ── Notifications (only for events caused by others) ──
            if (data.type === 'issue_created' && data.title) {
              addNotification({
                type: 'info',
                title: 'New issue created',
                message: data.title,
              });
            }

            if (data.type === 'comment_created' && data.author_name) {
              // Don't notify for own comments
              const isOwnComment = user?.fullName === data.author_name
                || user?.firstName === data.author_name;
              if (!isOwnComment) {
                addNotification({
                  type: 'info',
                  title: `${data.author_name} commented`,
                  message: `On issue ${data.issue_id?.slice(0, 8) ?? ''}…`,
                });
              }
            }
          } catch {
            // Ignore parse errors (e.g. keep-alive pings)
          }
        };

        es.onerror = () => {
          if (cancelled) return;
          es.close();
          // Reconnect after 5 seconds
          reconnectTimeoutRef.current = setTimeout(() => {
            if (!cancelled) connect();
          }, 5000);
        };
      } catch {
        // Token fetch failed, retry later
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!cancelled) connect();
        }, 10000);
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [getToken, queryClient, addNotification, user]);
}
