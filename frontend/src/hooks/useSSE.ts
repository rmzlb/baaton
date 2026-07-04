import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth, useUser } from '@clerk/clerk-react';
import { useNotificationStore } from '@/stores/notifications';
import { useIssuesStore } from '@/stores/issues';
import { getClientId } from '@/lib/clientId';
import type { Issue } from '@/lib/types';

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

        // ── Issues: per-entity merge (no board refetch on drops/updates) ──
        // The backend emits the full issue JSON as the event payload. We merge
        // it by id into every cache instead of invalidating, which avoids the
        // post-drop flicker and keeps other tabs in sync in real time.
        //
        // Last-write-wins: an incoming event is applied only if its updated_at
        // is >= the cached row's. This also suppresses the origin tab's own
        // echo — after the mutation succeeds the tab already merged the server
        // row (same updated_at), so the SSE copy is a no-op.
        //
        // Echo suppression (full): once the backend echoes the mutation's
        // X-Client-Id as `origin` on the event, compare it to getClientId() and
        // skip early. See useApi.ts (X-Client-Id header is already sent).
        const isNewer = (incoming?: string | null, existing?: string | null): boolean => {
          if (!incoming) return true;
          if (!existing) return true;
          return new Date(incoming).getTime() >= new Date(existing).getTime();
        };

        const mergeIssueEverywhere = (incoming: Issue) => {
          // 1. Zustand store (drives optimistic board rendering)
          const store = useIssuesStore.getState();
          const current = store.issues[incoming.id];
          if (!current || isNewer(incoming.updated_at, current.updated_at)) {
            store.updateIssue(incoming.id, incoming);
          }

          // 2. Composite project-board caches ({ project, issues, tags })
          queryClient.getQueriesData<{ issues?: Issue[] }>({ queryKey: ['project-board'] }).forEach(([key, data]) => {
            if (!data?.issues) return;
            const idx = data.issues.findIndex((i) => i.id === incoming.id);
            if (idx === -1) return;
            if (!isNewer(incoming.updated_at, data.issues[idx].updated_at)) return;
            const next = data.issues.slice();
            next[idx] = { ...next[idx], ...incoming };
            queryClient.setQueryData(key, { ...data, issues: next });
          });

          // 3. Flat all-issues cache
          queryClient.setQueryData<Issue[]>(['all-issues'], (old) =>
            old?.map((i) => (i.id === incoming.id && isNewer(incoming.updated_at, i.updated_at) ? { ...i, ...incoming } : i)),
          );

          // 4. Touched issue detail
          queryClient.invalidateQueries({ queryKey: ['issue', incoming.id] });
        };

        const removeIssueEverywhere = (id: string) => {
          useIssuesStore.getState().removeIssue(id);
          queryClient.getQueriesData<{ issues?: Issue[] }>({ queryKey: ['project-board'] }).forEach(([key, data]) => {
            if (!data?.issues) return;
            if (!data.issues.some((i) => i.id === id)) return;
            queryClient.setQueryData(key, { ...data, issues: data.issues.filter((i) => i.id !== id) });
          });
          queryClient.setQueryData<Issue[]>(['all-issues'], (old) => old?.filter((i) => i.id !== id));
        };

        // issue.created: full refetch of lists it may belong to (we don't know
        // which board/filter set it lands in without re-running queries).
        es.addEventListener('issue.created', (event) => {
          if (cancelled) return;
          const incoming = parse<Issue & { origin?: string }>(event);
          if (incoming?.origin && incoming.origin === getClientId()) return;
          queryClient.invalidateQueries({ queryKey: ['project-board'] });
          queryClient.invalidateQueries({ queryKey: ['all-issues'] });
          queryClient.invalidateQueries({ queryKey: ['issues'] });
        });

        const MERGE_EVENTS = [
          'issue.updated',
          'issue.status_changed',
          'issue.archived',
          'issue.unarchived',
        ] as const;
        for (const name of MERGE_EVENTS) {
          es.addEventListener(name, (event) => {
            if (cancelled) return;
            const incoming = parse<Issue & { origin?: string }>(event);
            if (!incoming?.id) return;
            // Echo suppression once backend wires `origin` (X-Client-Id).
            if (incoming.origin && incoming.origin === getClientId()) return;
            mergeIssueEverywhere(incoming);
            queryClient.invalidateQueries({ queryKey: ['activity'] });
          });
        }

        es.addEventListener('issue.deleted', (event) => {
          if (cancelled) return;
          const incoming = parse<{ id?: string; origin?: string }>(event);
          if (!incoming?.id) return;
          if (incoming.origin && incoming.origin === getClientId()) return;
          removeIssueEverywhere(incoming.id);
          queryClient.invalidateQueries({ queryKey: ['activity'] });
        });

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
