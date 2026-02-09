import { useAuth } from '@clerk/clerk-react';
import { useCallback, useMemo } from 'react';
import { api, ApiError } from '@/lib/api';
import type {
  Project,
  Issue,
  IssueDetail,
  ApiKey,
  CreateIssueRequest,
  UpdateIssueRequest,
  CreateTLDRRequest,
  CreateCommentRequest,
  Comment,
  ProjectTag,
} from '@/lib/types';

/**
 * Hook that wraps the API client with the current Clerk session token.
 * Returns authenticated fetch methods for all API endpoints.
 *
 * Handles:
 * - Auto-attaching `Authorization: Bearer <token>` to every request
 * - 401 errors → redirect to sign-in
 * - Typed responses for all endpoints
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const api = useApi();
 *   const projects = await api.projects.list();
 *   const issue = await api.issues.get(id);
 * }
 * ```
 */
export function useApi() {
  const { getToken, signOut } = useAuth();

  const getAuthToken = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) {
        throw new ApiError(401, 'UNAUTHORIZED', 'No active session');
      }
      return token;
    } catch (err) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Failed to get auth token');
    }
  }, [getToken]);

  /**
   * Wraps an async API call with error handling:
   * - 401 → sign out and redirect to /sign-in
   * - 404 → re-throw with clear message
   * - 500 → re-throw with server error message
   */
  const withErrorHandling = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 401) {
            await signOut({ redirectUrl: '/sign-in' });
          }
        }
        throw err;
      }
    },
    [signOut],
  );

  return useMemo(() => ({
    // ─── Low-level methods ─────────────────────
    /** Generic authenticated GET request */
    get: async <T>(path: string): Promise<T> =>
      withErrorHandling(async () => {
        const token = await getAuthToken();
        return api.get<T>(path, token);
      }),

    /** Generic authenticated POST request */
    post: async <T>(path: string, body: unknown): Promise<T> =>
      withErrorHandling(async () => {
        const token = await getAuthToken();
        return api.post<T>(path, body, token);
      }),

    /** Generic authenticated PATCH request */
    patch: async <T>(path: string, body: unknown): Promise<T> =>
      withErrorHandling(async () => {
        const token = await getAuthToken();
        return api.patch<T>(path, body, token);
      }),

    /** Generic authenticated DELETE request */
    del: async <T>(path: string): Promise<T> =>
      withErrorHandling(async () => {
        const token = await getAuthToken();
        return api.delete<T>(path, token);
      }),

    // ─── Projects ──────────────────────────────
    projects: {
      list: async (): Promise<Project[]> =>
        withErrorHandling(async () => {
          const token = await getAuthToken();
          return api.get<Project[]>('/projects', token);
        }),

      get: async (id: string): Promise<Project> =>
        withErrorHandling(async () => {
          const token = await getAuthToken();
          return api.get<Project>(`/projects/${id}`, token);
        }),

      getBySlug: async (slug: string): Promise<Project> =>
        withErrorHandling(async () => {
          const token = await getAuthToken();
          const projects = await api.get<Project[]>('/projects', token);
          const project = projects.find(p => p.slug === slug);
          if (!project) throw new ApiError(404, 'NOT_FOUND', `Project "${slug}" not found`);
          return project;
        }),

      create: async (body: {
        name: string;
        slug: string;
        description?: string;
        prefix: string;
      }): Promise<Project> =>
        withErrorHandling(async () => {
          const token = await getAuthToken();
          return api.post<Project>('/projects', body, token);
        }),

      update: async (
        id: string,
        body: Partial<Pick<Project, 'name' | 'description'>>,
      ): Promise<Project> =>
        withErrorHandling(async () => {
          const token = await getAuthToken();
          return api.patch<Project>(`/projects/${id}`, body, token);
        }),

      delete: async (id: string): Promise<void> =>
        withErrorHandling(async () => {
          const token = await getAuthToken();
          return api.delete(`/projects/${id}`, token);
        }),
    },

    // ─── Issues ────────────────────────────────
    issues: {
      listByProject: async (
        projectId: string,
        params?: {
          status?: string;
          priority?: string;
          type?: string;
          search?: string;
          limit?: number;
          offset?: number;
        },
      ): Promise<Issue[]> =>
        withErrorHandling(async () => {
          const token = await getAuthToken();
          const query = new URLSearchParams();
          if (params?.status) query.set('status', params.status);
          if (params?.priority) query.set('priority', params.priority);
          if (params?.type) query.set('type', params.type);
          if (params?.search) query.set('search', params.search);
          if (params?.limit) query.set('limit', String(params.limit));
          if (params?.offset) query.set('offset', String(params.offset));
          const qs = query.toString();
          return api.get<Issue[]>(
            `/projects/${projectId}/issues${qs ? `?${qs}` : ''}`,
            token,
          );
        }),

      get: async (id: string): Promise<IssueDetail> =>
        withErrorHandling(async () => {
          const token = await getAuthToken();
          return api.get<IssueDetail>(`/issues/${id}`, token);
        }),

      listMine: async (assigneeId: string): Promise<Issue[]> =>
        withErrorHandling(async () => {
          const token = await getAuthToken();
          return api.get<Issue[]>(`/issues/mine?assignee_id=${encodeURIComponent(assigneeId)}`, token);
        }),

      create: async (body: CreateIssueRequest): Promise<Issue> =>
        withErrorHandling(async () => {
          const token = await getAuthToken();
          return api.post<Issue>('/issues', body, token);
        }),

      update: async (id: string, body: UpdateIssueRequest): Promise<Issue> =>
        withErrorHandling(async () => {
          const token = await getAuthToken();
          return api.patch<Issue>(`/issues/${id}`, body, token);
        }),

      updatePosition: async (
        id: string,
        status: string,
        position: number,
      ): Promise<Issue> =>
        withErrorHandling(async () => {
          const token = await getAuthToken();
          return api.patch<Issue>(`/issues/${id}/position`, {
            status,
            position,
          }, token);
        }),

      delete: async (id: string): Promise<void> =>
        withErrorHandling(async () => {
          const token = await getAuthToken();
          return api.delete(`/issues/${id}`, token);
        }),
    },

    // ─── TLDRs ─────────────────────────────────
    tldrs: {
      create: async (issueId: string, body: CreateTLDRRequest): Promise<void> =>
        withErrorHandling(async () => {
          const token = await getAuthToken();
          return api.post(`/issues/${issueId}/tldr`, body, token);
        }),
    },

    // ─── API Keys ──────────────────────────────
    apiKeys: {
      list: async (): Promise<ApiKey[]> =>
        withErrorHandling(async () => {
          const token = await getAuthToken();
          return api.get<ApiKey[]>('/api-keys', token);
        }),

      create: async (body: {
        name: string;
        permissions?: string[];
      }): Promise<ApiKey & { key: string }> =>
        withErrorHandling(async () => {
          const token = await getAuthToken();
          return api.post<ApiKey & { key: string }>('/api-keys', body, token);
        }),

      delete: async (id: string): Promise<void> =>
        withErrorHandling(async () => {
          const token = await getAuthToken();
          return api.delete(`/api-keys/${id}`, token);
        }),
    },

    // ─── Comments ──────────────────────────────
    comments: {
      list: async (issueId: string): Promise<Comment[]> =>
        withErrorHandling(async () => {
          const token = await getAuthToken();
          return api.get<Comment[]>(`/issues/${issueId}/comments`, token);
        }),

      create: async (issueId: string, body: CreateCommentRequest): Promise<Comment> =>
        withErrorHandling(async () => {
          const token = await getAuthToken();
          return api.post<Comment>(`/issues/${issueId}/comments`, body, token);
        }),
    },

    // ─── Tags ──────────────────────────────────
    tags: {
      listByProject: async (projectId: string): Promise<ProjectTag[]> =>
        withErrorHandling(async () => {
          const token = await getAuthToken();
          return api.get<ProjectTag[]>(`/projects/${projectId}/tags`, token);
        }),

      create: async (projectId: string, body: { name: string; color: string }): Promise<ProjectTag> =>
        withErrorHandling(async () => {
          const token = await getAuthToken();
          return api.post<ProjectTag>(`/projects/${projectId}/tags`, body, token);
        }),

      delete: async (tagId: string): Promise<void> =>
        withErrorHandling(async () => {
          const token = await getAuthToken();
          return api.delete(`/tags/${tagId}`, token);
        }),
    },

    // ─── Invites ───────────────────────────────
    invites: {
      create: async (body: { email_address: string; role?: string }): Promise<{
        id: string;
        email_address: string;
        status: string;
        url: string | null;
      }> =>
        withErrorHandling(async () => {
          const token = await getAuthToken();
          return api.post('/invites', body, token);
        }),
    },

    // ─── Public (no auth) ──────────────────────
    public: {
      submit: async (
        slug: string,
        body: {
          title: string;
          description?: string;
          type?: string;
          reporter_name?: string;
          reporter_email?: string;
        },
      ): Promise<Issue> => {
        // Public endpoints don't need error handling for 401
        return api.public.post<Issue>(`/public/${slug}/submit`, body);
      },
    },
  }), [getAuthToken, withErrorHandling]);
}
