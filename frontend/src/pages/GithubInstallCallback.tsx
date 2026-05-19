import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { GitFork, CheckCircle2, AlertCircle, Loader2, Clock } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { api, ApiError } from '@/lib/api';
import type { GitHubInstallation } from '@/lib/types';

type Phase =
  | 'loading'
  | 'connected'
  | 'pending_admin_approval'
  | 'error_invalid'
  | 'error_expired'
  | 'error_forbidden'
  | 'error_unknown';

/**
 * Public landing page for the GitHub App install callback.
 * GitHub redirects here with `?state=&installation_id=&setup_action=`.
 * We POST to the Clerk-authenticated `/github/install/finalize` endpoint
 * (Clerk session is loaded client-side, so this page itself is public).
 */
export default function GithubInstallCallback() {
  const { t } = useTranslation();
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [params] = useSearchParams();
  const [phase, setPhase] = useState<Phase>('loading');
  const finalizedRef = useRef(false);

  const state = params.get('state') ?? '';
  const installationIdRaw = params.get('installation_id');
  const installationId = installationIdRaw ? Number(installationIdRaw) : undefined;
  const setupAction = params.get('setup_action') ?? undefined;

  useEffect(() => {
    if (!isLoaded) return;
    if (finalizedRef.current) return;
    finalizedRef.current = true;

    if (!isSignedIn) {
      // User isn't signed in yet — bounce through Clerk and come back.
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/sign-in?redirect_url=${next}`);
      return;
    }

    if (!state) {
      setPhase('error_invalid');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) {
          setPhase('error_forbidden');
          return;
        }

        const body = {
          state,
          installation_id: installationId,
          setup_action: setupAction,
        };

        const res = await api.post<{ status: string; installation?: GitHubInstallation }>(
          '/github/install/finalize',
          body,
          token,
        );

        if (cancelled) return;

        if (res.status === 'pending_admin_approval') {
          setPhase('pending_admin_approval');
          return;
        }

        setPhase('connected');
        // Brief pause so the user sees the success state before redirect.
        setTimeout(() => {
          window.location.replace('/settings/integrations?github=connected');
        }, 900);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError) {
          if (err.status === 400) setPhase('error_invalid');
          else if (err.status === 401) setPhase('error_forbidden');
          else if (err.status === 403) setPhase('error_forbidden');
          else setPhase('error_unknown');
        } else {
          setPhase('error_unknown');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, state, installationId, setupAction, getToken]);

  // Pending-admin polling: every 30s, re-check `/github/installation`.
  // If the admin approves, the webhook will land first and the row will exist.
  useEffect(() => {
    if (phase !== 'pending_admin_approval') return;
    let stopped = false;

    const poll = async () => {
      try {
        const token = await getToken();
        if (!token || stopped) return;
        const installation = await api.get<GitHubInstallation | null>(
          '/github/installation',
          token,
        );
        if (installation && !stopped) {
          window.location.replace('/settings/integrations?github=connected');
        }
      } catch {
        // swallow — keep polling
      }
    };

    const id = window.setInterval(poll, 30_000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [phase, getToken]);

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-[--color-bg] px-4">
      <div className="w-full max-w-md rounded-xl border border-[--color-border] bg-[--color-surface]">
        <div className="px-5 py-6 flex flex-col items-center text-center">
          <div className="h-12 w-12 rounded-xl border border-[--color-border] bg-[--color-surface-hover] flex items-center justify-center mb-4">
            <GitFork size={20} className="text-[--color-primary]" />
          </div>
          <CallbackBody phase={phase} t={t} />
        </div>
      </div>
    </div>
  );
}

function CallbackBody({
  phase,
  t,
}: {
  phase: Phase;
  t: (k: string, opts?: { defaultValue?: string }) => string;
}) {
  if (phase === 'loading') {
    return (
      <>
        <Loader2 size={18} className="animate-spin text-[--color-accent] mb-2" />
        <h1 className="text-sm font-semibold text-[--color-primary]">
          {t('github.connecting', { defaultValue: 'Connecting GitHub…' })}
        </h1>
        <p className="mt-1 text-[12px] text-[--color-muted]">
          {t('github.connectingHint', {
            defaultValue: 'Verifying your install with GitHub.',
          })}
        </p>
      </>
    );
  }

  if (phase === 'connected') {
    return (
      <>
        <CheckCircle2 size={18} className="text-emerald-400 mb-2" />
        <h1 className="text-sm font-semibold text-[--color-primary]">
          {t('github.connected', { defaultValue: 'GitHub connected' })}
        </h1>
        <p className="mt-1 text-[12px] text-[--color-muted]">
          {t('github.connectedRedirect', {
            defaultValue: 'Redirecting you to integrations…',
          })}
        </p>
      </>
    );
  }

  if (phase === 'pending_admin_approval') {
    return (
      <>
        <Clock size={18} className="text-amber-400 mb-2" />
        <h1 className="text-sm font-semibold text-[--color-primary]">
          {t('github.pendingApproval', { defaultValue: 'Pending admin approval' })}
        </h1>
        <p className="mt-1 text-[12px] text-[--color-muted]">
          {t('github.pendingApprovalHint', {
            defaultValue:
              "Your org admin needs to approve this install. We'll auto-detect when they do.",
          })}
        </p>
      </>
    );
  }

  const errorKey =
    phase === 'error_invalid'
      ? 'github.errorState'
      : phase === 'error_expired'
        ? 'github.errorExpired'
        : phase === 'error_forbidden'
          ? 'github.errorForbidden'
          : 'github.errorState';

  const errorDefault =
    phase === 'error_invalid'
      ? 'Invalid install link. Please start the connection from the integrations page.'
      : phase === 'error_expired'
        ? 'This install link has expired. Please start over.'
        : phase === 'error_forbidden'
          ? "This install link doesn't belong to your account. Sign in with the right user and try again."
          : 'Something went wrong while connecting GitHub.';

  return (
    <>
      <AlertCircle size={18} className="text-red-400 mb-2" />
      <h1 className="text-sm font-semibold text-[--color-primary]">
        {t('github.errorState', { defaultValue: 'Connection failed' })}
      </h1>
      <p className="mt-1 text-[12px] text-[--color-muted]">
        {t(errorKey, { defaultValue: errorDefault })}
      </p>
      <Link
        to="/settings/integrations"
        className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-[--color-border] bg-[--color-surface-hover] px-3 py-1.5 text-[11px] font-medium text-[--color-primary] transition-[transform,colors] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-[--color-surface] active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-amber-500/30"
      >
        {t('github.tryAgain', { defaultValue: 'Try again' })}
      </Link>
    </>
  );
}
