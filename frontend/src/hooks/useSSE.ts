import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth, useUser } from '@clerk/clerk-react';
import { useNotificationStore } from '@/stores/notifications';

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
        const token = await getToken().catch(() => null);
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

        // The backend emits *named* SSE events (e.g. `issue.created`) whose
        // `data` payload is the raw entity JSON — not a wrapped { type } object.
        // Named events never reach `onmessage`, so each needs its own listener.
        const parse = <T,>(event: Event): T | null => {
          try {
            return JSON.parse((event as MessageEvent).data) as T;
          } catch {
            return null;
          }
        };

        // ── Issues: any mutation refreshes lists, board and the touched issue ──
        const ISSUE_EVENTS = [
          'issue.created',
          'issue.updated',
          'issue.status_changed',
          'issue.archived',
          'issue.unarchived',
          'issue.deleted',
        ] as const;
        for (const name of ISSUE_EVENTS) {
          es.addEventListener(name, (event) => {
            if (cancelled) return;
            const data = parse<{ id?: string; project_id?: string }>(event);
            queryClient.invalidateQueries({ queryKey: ['issues'] });
            queryClient.invalidateQueries({ queryKey: ['all-issues'] });
            queryClient.invalidateQueries({ queryKey: ['project-board'] });
            queryClient.invalidateQueries({ queryKey: ['activity'] });
            if (data?.id) {
              queryClient.invalidateQueries({ queryKey: ['issue', data.id] });
            }
          });
        }

        // ── Comments: refresh the parent issue thread + activity feeds ──
        const COMMENT_EVENTS = ['comment.created', 'comment.updated', 'comment.deleted'] as const;
        for (const name of COMMENT_EVENTS) {
          es.addEventListener(name, (event) => {
            if (cancelled) return;
            const data = parse<{ issue_id?: string }>(event);
            if (data?.issue_id) {
              queryClient.invalidateQueries({ queryKey: ['issue', data.issue_id] });
              queryClient.invalidateQueries({ queryKey: ['activity', data.issue_id] });
            }
            queryClient.invalidateQueries({ queryKey: ['activity'] });
          });
        }

        // ── Project-level config (workflow statuses) ──
        // Statuses live on the project, so an admin edit must refresh every
        // connected member's board immediately.
        es.addEventListener('project.updated', () => {
          if (cancelled) return;
          queryClient.invalidateQueries({ queryKey: ['project-board'] });
          queryClient.invalidateQueries({ queryKey: ['projects'] });
        });

        // ── Client fell behind (broadcast buffer lag) → full refetch ──
        es.addEventListener('system.lagged', () => {
          if (cancelled) return;
          queryClient.invalidateQueries();
        });

        // ── Notifications for events caused by others ──
        es.addEventListener('issue.created', (event) => {
          if (cancelled) return;
          const issue = parse<{ title?: string }>(event);
          if (issue?.title) {
            addNotification({ type: 'info', title: 'New issue created', message: issue.title });
          }
        });

        es.addEventListener('comment.created', (event) => {
          if (cancelled) return;
          const comment = parse<{ author_name?: string; issue_id?: string }>(event);
          const author = comment?.author_name;
          if (!author) return;
          const isOwnComment = user?.fullName === author || user?.firstName === author;
          if (!isOwnComment) {
            addNotification({
              type: 'info',
              title: `${author} commented`,
              message: `On issue ${comment?.issue_id?.slice(0, 8) ?? ''}…`,
            });
          }
        });

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
