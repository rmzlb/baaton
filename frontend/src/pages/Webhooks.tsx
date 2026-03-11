import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import {
  Plus, Trash2, Globe, CheckCircle, XCircle, AlertTriangle,
  Webhook as WebhookIcon, Radio, Zap,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'https://api.baaton.dev/api/v1';

const EVENT_TYPES = [
  { type: 'issue.created', description: 'A new issue is created', category: 'Issues' },
  { type: 'issue.updated', description: 'An issue is updated (title, description, assignees, priority, etc.)', category: 'Issues' },
  { type: 'issue.deleted', description: 'An issue is permanently deleted', category: 'Issues' },
  { type: 'status.changed', description: 'An issue status changes (e.g. backlog → in_progress)', category: 'Issues' },
  { type: 'comment.created', description: 'A new comment is added to an issue', category: 'Comments' },
  { type: 'comment.deleted', description: 'A comment is removed from an issue', category: 'Comments' },
];

interface WebhookRow {
  id: string;
  url: string;
  event_types: string[];
  enabled: boolean;
  failure_count: number;
  last_error: string | null;
  last_delivered_at: string | null;
  created_at: string;
}

function useApi() {
  const { getToken } = useAuth();
  return async (path: string, opts?: RequestInit) => {
    const token = await getToken();
    const res = await fetch(`${API}${path}`, {
      ...opts,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...opts?.headers },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  };
}

export default function Webhooks() {
  const [tab, setTab] = useState<'endpoints' | 'events'>('endpoints');
  const [showCreate, setShowCreate] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  const api = useApi();
  const qc = useQueryClient();

  const { data: webhooks = [], isLoading } = useQuery({
    queryKey: ['webhooks'],
    queryFn: async () => {
      const res = await api('/webhooks');
      return (res.data || []) as WebhookRow[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await api('/webhooks', {
        method: 'POST',
        body: JSON.stringify({
          url: newUrl,
          event_types: selectedEvents.length > 0 ? selectedEvents : undefined,
        }),
      });
      return res.data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['webhooks'] });
      setCreatedSecret(data?.secret || null);
      setNewUrl('');
      setSelectedEvents([]);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/webhooks/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  });

  const toggleEvent = (type: string) => {
    setSelectedEvents((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-primary">Webhooks</h1>
          <p className="text-sm text-muted mt-1">
            Get real-time notifications when events happen in your projects.
          </p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setCreatedSecret(null); }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-black font-medium text-sm hover:brightness-110 transition"
        >
          <Plus className="w-4 h-4" />
          Add Endpoint
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border">
        {(['endpoints', 'events'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-amber-500 text-primary'
                : 'border-transparent text-muted hover:text-secondary'
            }`}
          >
            {t === 'endpoints' ? 'Endpoints' : 'Event Catalog'}
          </button>
        ))}
      </div>

      {/* Endpoints Tab */}
      {tab === 'endpoints' && (
        <div>
          {isLoading ? (
            <div className="text-muted text-sm py-12 text-center">Loading webhooks…</div>
          ) : webhooks.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-border rounded-xl">
              <WebhookIcon className="w-12 h-12 text-muted mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-primary mb-2">No webhooks yet</h3>
              <p className="text-sm text-muted mb-6 max-w-sm mx-auto">
                Create your first webhook endpoint to start receiving real-time event notifications.
              </p>
              <button
                onClick={() => { setShowCreate(true); setCreatedSecret(null); }}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-black font-medium text-sm"
              >
                Create Webhook
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {webhooks.map((hook) => (
                <div key={hook.id} className="p-4 rounded-xl border border-border bg-surface/30 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      hook.failure_count > 5 ? 'bg-red-500/10' : hook.enabled ? 'bg-green-500/10' : 'bg-muted/10'
                    }`}>
                      {hook.failure_count > 5 ? (
                        <AlertTriangle className="w-4 h-4 text-red-400" />
                      ) : hook.enabled ? (
                        <CheckCircle className="w-4 h-4 text-green-400" />
                      ) : (
                        <XCircle className="w-4 h-4 text-muted" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Globe className="w-3.5 h-3.5 text-muted shrink-0" />
                        <span className="text-sm font-mono text-primary truncate">{hook.url}</span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {hook.event_types.map((et) => (
                          <span key={et} className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 text-[10px] font-medium">
                            {et}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {hook.last_error && (
                      <span className="text-[10px] text-red-400 max-w-[120px] truncate">{hook.last_error}</span>
                    )}
                    <button
                      onClick={() => deleteMutation.mutate(hook.id)}
                      className="p-2 rounded-lg hover:bg-red-500/10 text-muted hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Event Catalog Tab */}
      {tab === 'events' && (
        <div className="space-y-6">
          {['Issues', 'Comments'].map((category) => (
            <div key={category}>
              <h3 className="text-sm font-medium text-secondary uppercase tracking-wide mb-3">{category}</h3>
              <div className="space-y-2">
                {EVENT_TYPES.filter((e) => e.category === category).map((evt) => (
                  <div key={evt.type} className="p-4 rounded-xl border border-border bg-surface/30 flex items-start gap-4">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
                      {evt.type.startsWith('issue') ? <Zap className="w-4 h-4 text-amber-500" /> : <Radio className="w-4 h-4 text-amber-500" />}
                    </div>
                    <div>
                      <code className="text-sm font-mono text-primary">{evt.type}</code>
                      <p className="text-sm text-muted mt-1">{evt.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
          <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-lg mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {createdSecret ? (
              <>
                <h2 className="text-lg font-semibold text-primary mb-2">Webhook Created ✓</h2>
                <p className="text-sm text-muted mb-4">
                  Save the signing secret now — you won't be able to see it again.
                </p>
                <div className="p-3 rounded-lg bg-[#0a0a0a] border border-border font-mono text-sm text-emerald-300 break-all mb-4">
                  {createdSecret}
                </div>
                <p className="text-xs text-muted mb-6">
                  Use this secret to verify webhook signatures via the <code className="text-primary">X-Baaton-Signature</code> header.
                </p>
                <button onClick={() => setShowCreate(false)} className="w-full py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-black font-medium text-sm">
                  Done
                </button>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold text-primary mb-4">Add Webhook Endpoint</h2>

                <label className="block text-sm font-medium text-secondary mb-1.5">Endpoint URL</label>
                <input
                  type="url"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://your-server.com/webhooks/baaton"
                  className="w-full px-3 py-2.5 rounded-lg bg-[#0a0a0a] border border-border text-primary text-sm placeholder:text-muted focus:outline-none focus:border-amber-500/40 mb-4"
                />

                <label className="block text-sm font-medium text-secondary mb-2">Events (leave empty for all)</label>
                <div className="space-y-2 max-h-48 overflow-y-auto mb-6">
                  {EVENT_TYPES.map((evt) => (
                    <label key={evt.type} className="flex items-center gap-3 p-2 rounded-lg hover:bg-surface/50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedEvents.includes(evt.type)}
                        onChange={() => toggleEvent(evt.type)}
                        className="rounded accent-amber-500"
                      />
                      <div>
                        <code className="text-xs text-primary">{evt.type}</code>
                        <p className="text-[11px] text-muted">{evt.description}</p>
                      </div>
                    </label>
                  ))}
                </div>

                <div className="flex gap-3">
                  <button onClick={() => setShowCreate(false)} className="flex-1 py-2.5 rounded-lg border border-border text-secondary text-sm font-medium hover:bg-surface/50">
                    Cancel
                  </button>
                  <button
                    onClick={() => createMutation.mutate()}
                    disabled={!newUrl.trim() || createMutation.isPending}
                    className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-black font-medium text-sm disabled:opacity-50"
                  >
                    {createMutation.isPending ? 'Creating…' : 'Create Webhook'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
