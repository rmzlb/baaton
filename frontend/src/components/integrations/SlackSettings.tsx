import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Plus, Trash2, Loader2, ExternalLink, Copy, Check } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { useNotificationStore } from '@/stores/notifications';

interface SlackIntegration {
  id: string;
  team_id: string;
  team_name: string | null;
  webhook_url: string | null;
  channel_mappings: Record<string, string>;
  created_at: string;
}

export function SlackSettings() {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const addNotification = useNotificationStore((s) => s.addNotification);
  const [showAdd, setShowAdd] = useState(false);
  const [teamId, setTeamId] = useState('');
  const [teamName, setTeamName] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [botToken, setBotToken] = useState('');
  const [copied, setCopied] = useState(false);

  const { data: integrations = [], isLoading } = useQuery({
    queryKey: ['slack-integrations'],
    queryFn: () => apiClient.get<SlackIntegration[]>('/integrations/slack'),
  });

  const createMutation = useMutation({
    mutationFn: () => apiClient.post('/integrations/slack', {
      team_id: teamId,
      team_name: teamName || undefined,
      bot_token: botToken,
      webhook_url: webhookUrl || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slack-integrations'] });
      setShowAdd(false);
      setTeamId('');
      setTeamName('');
      setWebhookUrl('');
      setBotToken('');
      addNotification({ type: 'success', title: t('slack.created'), message: '' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/integrations/slack/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slack-integrations'] });
      addNotification({ type: 'success', title: t('slack.deleted'), message: '' });
    },
  });

  const slashEndpoint = 'https://api.baaton.dev/api/v1/public/slack/command';

  const handleCopy = () => {
    navigator.clipboard.writeText(slashEndpoint);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10">
            <MessageSquare size={20} className="text-purple-400" />
          </div>
          <div>
            <h3 className="font-semibold text-primary">{t('slack.title')}</h3>
            <p className="text-xs text-muted">{t('slack.description')}</p>
          </div>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1.5 rounded-lg bg-accent/10 border border-accent/20 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 transition-colors"
        >
          <Plus size={14} />
          {t('slack.addWorkspace')}
        </button>
      </div>

      {/* Slash command endpoint */}
      <div className="mb-4 rounded-lg bg-surface-hover p-3">
        <p className="text-[11px] text-muted mb-1">{t('slack.slashEndpoint')}</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs font-mono text-secondary bg-bg rounded px-2 py-1 truncate">
            {slashEndpoint}
          </code>
          <button onClick={handleCopy} className="shrink-0 rounded p-1.5 text-muted hover:text-secondary hover:bg-surface transition-colors">
            {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
          </button>
        </div>
        <p className="text-[10px] text-muted mt-1">{t('slack.slashHint')}</p>
      </div>

      {/* Existing integrations */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={20} className="animate-spin text-muted" />
        </div>
      ) : integrations.length === 0 ? (
        <p className="text-sm text-muted text-center py-4">{t('slack.noIntegrations')}</p>
      ) : (
        <div className="space-y-2">
          {integrations.map((integration) => (
            <div key={integration.id} className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium text-primary">
                  {integration.team_name || integration.team_id}
                </p>
                <p className="text-[11px] text-muted">
                  {t('slack.connectedSince')} {new Date(integration.created_at).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => deleteMutation.mutate(integration.id)}
                disabled={deleteMutation.isPending}
                className="rounded-lg p-1.5 text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <div className="mt-4 rounded-lg border border-border p-4 space-y-3">
          <h4 className="text-sm font-medium text-primary">{t('slack.addWorkspace')}</h4>
          <div>
            <label className="text-[11px] text-muted">{t('slack.teamId')}</label>
            <input
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              placeholder="T0123456789"
              className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder:text-muted outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="text-[11px] text-muted">{t('slack.teamName')}</label>
            <input
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="My Workspace"
              className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder:text-muted outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="text-[11px] text-muted">{t('slack.botToken')}</label>
            <input
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder="xoxb-..."
              type="password"
              className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder:text-muted outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="text-[11px] text-muted">{t('slack.webhookUrl')}</label>
            <input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://hooks.slack.com/services/..."
              className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder:text-muted outline-none focus:border-accent"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowAdd(false)}
              className="px-3 py-1.5 rounded-lg text-xs text-secondary hover:text-primary transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => createMutation.mutate()}
              disabled={!teamId || !botToken || createMutation.isPending}
              className="px-4 py-1.5 rounded-lg bg-accent text-black text-xs font-semibold hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              {createMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : t('slack.connect')}
            </button>
          </div>
          <a
            href="https://api.slack.com/apps"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[11px] text-accent hover:underline"
          >
            <ExternalLink size={10} />
            {t('slack.createApp')}
          </a>
        </div>
      )}
    </div>
  );
}
