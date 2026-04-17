import { GitFork as Github, Mail, MessageSquare as Slack, Plug, Unplug, ExternalLink } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

/* ── AgentMail flow diagram ─── */
function AgentMailFlowDiagram() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center gap-3 py-4 px-2 text-xs text-secondary">
      {/* Inbox */}
      <div className="flex flex-col items-center gap-1.5">
        <div className="h-9 w-9 rounded-xl border border-border bg-surface-hover flex items-center justify-center">
          <Mail size={16} className="text-accent" />
        </div>
        <span className="text-[10px] text-muted">{t('integrations.agentmail.flowEmail')}</span>
      </div>
      {/* Arrow */}
      <div className="flex-1 h-px bg-border relative max-w-[48px]">
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-muted">→</span>
      </div>
      {/* AgentMail */}
      <div className="flex flex-col items-center gap-1.5">
        <div className="h-9 w-9 rounded-xl border border-accent/40 bg-accent/10 flex items-center justify-center">
          <Mail size={16} className="text-accent" />
        </div>
        <span className="text-[10px] text-accent font-medium">AgentMail</span>
      </div>
      {/* Arrow */}
      <div className="flex-1 h-px bg-border relative max-w-[48px]">
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-muted">→</span>
      </div>
      {/* Baaton */}
      <div className="flex flex-col items-center gap-1.5">
        <div className="h-9 w-9 rounded-xl border border-border bg-surface-hover flex items-center justify-center">
          <span className="text-base">🏃</span>
        </div>
        <span className="text-[10px] text-muted">{t('integrations.agentmail.flowBaaton')}</span>
      </div>
    </div>
  );
}

/* ── Integration Card ─── */
interface IntegrationCardProps {
  icon: React.ReactNode;
  name: string;
  description: string;
  status: 'connected' | 'disconnected' | 'coming_soon';
  onConnect?: () => void;
  onDisconnect?: () => void;
  connecting?: boolean;
  children?: React.ReactNode;
  badge?: string;
}

function IntegrationCard({
  icon, name, description,
  status, onConnect, onDisconnect, connecting,
  children, badge,
}: IntegrationCardProps) {
  const { t } = useTranslation();

  return (
    <div className={cn(
      'rounded-xl border bg-surface p-5 transition-colors',
      status === 'connected' ? 'border-accent/30' : 'border-border',
    )}>
      <div className="flex items-start gap-4">
        <div className={cn(
          'h-11 w-11 rounded-xl border flex items-center justify-center shrink-0',
          status === 'connected' ? 'border-accent/40 bg-accent/10' : 'border-border bg-surface-hover',
        )}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-primary">{name}</h3>
            {badge && (
              <span className="rounded-full bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 text-[10px] font-semibold text-amber-400 uppercase tracking-wider">
                {badge}
              </span>
            )}
            {status === 'connected' && (
              <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {t('settings.connected')}
              </span>
            )}
          </div>
          <p className="text-sm text-secondary mt-1">{description}</p>
        </div>
        <div className="shrink-0">
          {status === 'coming_soon' ? null : status === 'connected' ? (
            <button
              onClick={onDisconnect}
              disabled={connecting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 text-xs text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
            >
              <Unplug size={12} />
              {t('integrations.disconnect')}
            </button>
          ) : (
            <button
              onClick={onConnect}
              disabled={connecting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-black text-xs font-semibold hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              <Plug size={12} />
              {connecting ? t('common.loading') : t('integrations.connect')}
            </button>
          )}
        </div>
      </div>
      {children && (
        <div className="mt-4 pt-4 border-t border-border">
          {children}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════ */

export default function Integrations() {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();

  /* ── GitHub status ── */
  const { data: githubInstallation } = useQuery({
    queryKey: ['github-installation'],
    queryFn: () => apiClient.github.getInstallation(),
    retry: false,
  });

  const disconnectGithubMutation = useMutation({
    mutationFn: () => apiClient.github.disconnect(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['github-installation'] }),
  });

  const githubConnected = githubInstallation?.status === 'active';

  /* ── Slack status — shown as disconnected until API endpoint is available ── */
  const slackConnected = false;
  const slackIntegrations: unknown[] = [];

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-primary">{t('integrations.title')}</h1>
        <p className="text-sm text-secondary mt-1">{t('integrations.subtitle')}</p>
      </div>

      {/* GitHub */}
      <IntegrationCard
        icon={<Github size={20} className="text-primary" />}
        name="GitHub"
        description={t('integrations.github.description')}
        status={githubConnected ? 'connected' : 'disconnected'}
        onConnect={() => window.open('https://github.com/apps/baaton/installations/new', '_blank')}
        onDisconnect={() => {
          if (confirm(t('github.disconnectConfirm'))) {
            disconnectGithubMutation.mutate();
          }
        }}
        connecting={disconnectGithubMutation.isPending}
      >
        {githubConnected && githubInstallation && (
          <p className="text-xs text-muted">
            {t('github.connectedTo', { account: githubInstallation.github_account_login ?? '—' })}
          </p>
        )}
      </IntegrationCard>

      {/* Slack */}
      <IntegrationCard
        icon={<Slack size={20} className="text-[#4A154B]" style={{ color: '#4A154B' }} />}
        name="Slack"
        description={t('integrations.slack.description')}
        status={slackConnected ? 'connected' : 'disconnected'}
        onConnect={() => window.open('https://slack.com/oauth/v2/authorize', '_blank')}
      >
        {slackConnected && (
          <p className="text-xs text-muted">
            {(slackIntegrations as unknown[]).length} {t('integrations.slack.workspaces')}
          </p>
        )}
      </IntegrationCard>

      {/* AgentMail */}
      <IntegrationCard
        icon={<Mail size={20} className="text-accent" />}
        name="AgentMail"
        description={t('integrations.agentmail.description')}
        status="coming_soon"
        badge={t('integrations.comingSoon')}
      >
        <div className="space-y-3">
          <p className="text-xs text-secondary">{t('integrations.agentmail.concept')}</p>
          <AgentMailFlowDiagram />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-bg p-3 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                <Mail size={12} className="text-accent" />
                {t('integrations.agentmail.feature1Title')}
              </div>
              <p className="text-[11px] text-muted">{t('integrations.agentmail.feature1Desc')}</p>
            </div>
            <div className="rounded-lg border border-border bg-bg p-3 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                <ExternalLink size={12} className="text-accent" />
                {t('integrations.agentmail.feature2Title')}
              </div>
              <p className="text-[11px] text-muted">{t('integrations.agentmail.feature2Desc')}</p>
            </div>
          </div>
          <a
            href="https://agentmail.to"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
          >
            agentmail.to
            <ExternalLink size={10} />
          </a>
        </div>
      </IntegrationCard>
    </div>
  );
}
