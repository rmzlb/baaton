import { useState } from 'react';
import { OrganizationProfile } from '@clerk/clerk-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Trash2, Copy, Eye, EyeOff, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { timeAgo } from '@/lib/utils';
import type { ApiKey } from '@/lib/types';

export function Settings() {
  return (
    <div className="p-4 md:p-6 space-y-8">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-[#fafafa]">Settings</h1>
        <p className="mt-1 text-sm text-[#a1a1aa]">
          Organization settings and API keys
        </p>
      </div>

      {/* API Keys Section */}
      <ApiKeysSection />

      {/* Clerk Organization Profile */}
      <div className="rounded-xl border border-[#262626] bg-[#141414] p-4 md:p-6">
        <h2 className="text-sm font-semibold text-[#fafafa] uppercase tracking-wider mb-4">
          Organization
        </h2>
        <OrganizationProfile
          appearance={{
            elements: {
              rootBox: 'w-full',
              card: 'bg-transparent shadow-none',
            },
          }}
        />
      </div>
    </div>
  );
}

function ApiKeysSection() {
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeySecret, setNewKeySecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: apiKeys = [], isLoading, error } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => apiClient.apiKeys.list(),
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => apiClient.apiKeys.create({ name }),
    onSuccess: (data) => {
      setNewKeySecret(data.key);
      setNewKeyName('');
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.apiKeys.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    createMutation.mutate(newKeyName.trim());
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // If the API keys endpoint returns a 404/error, the backend might not support it yet
  const endpointAvailable = !error;

  return (
    <div className="rounded-xl border border-[#262626] bg-[#141414] p-4 md:p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <KeyRound size={20} className="text-[#f59e0b]" />
          <div>
            <h2 className="text-sm font-semibold text-[#fafafa] uppercase tracking-wider">
              API Keys
            </h2>
            <p className="text-xs text-[#a1a1aa] mt-0.5">
              Create API keys for AI agents to access your projects
            </p>
          </div>
        </div>
      </div>

      {/* New Key Created Banner */}
      {newKeySecret && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-200">
                Copy your API key now — it won't be shown again!
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 rounded-md bg-[#0a0a0a] px-3 py-2 text-xs font-mono text-[#fafafa] border border-[#262626] truncate">
                  {newKeySecret}
                </code>
                <button
                  onClick={() => handleCopy(newKeySecret)}
                  className="shrink-0 rounded-md bg-[#1f1f1f] p-2 text-[#a1a1aa] hover:text-[#fafafa] transition-colors"
                >
                  {copied ? <CheckCircle2 size={16} className="text-green-400" /> : <Copy size={16} />}
                </button>
              </div>
              <button
                onClick={() => setNewKeySecret(null)}
                className="mt-2 text-xs text-amber-400 hover:underline"
              >
                I've copied it, dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Form */}
      {showCreate ? (
        <form onSubmit={handleCreate} className="mb-6 flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs text-[#a1a1aa] mb-1.5">Key Name</label>
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g., claude-code-agent"
              className="w-full rounded-lg border border-[#262626] bg-[#0a0a0a] px-3 py-2.5 text-sm text-[#fafafa] placeholder-[#a1a1aa] focus:border-[#f59e0b] focus:outline-none transition-colors"
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={!newKeyName.trim() || createMutation.isPending}
            className="rounded-lg bg-[#f59e0b] px-4 py-2.5 text-sm font-medium text-black hover:bg-[#d97706] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {createMutation.isPending ? 'Creating…' : 'Create'}
          </button>
          <button
            type="button"
            onClick={() => { setShowCreate(false); setNewKeyName(''); }}
            className="rounded-lg px-3 py-2.5 text-sm text-[#a1a1aa] hover:text-[#fafafa] transition-colors"
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          className="mb-6 flex items-center gap-2 rounded-lg border border-dashed border-[#262626] px-4 py-2.5 text-sm text-[#a1a1aa] hover:border-[#f59e0b] hover:text-[#f59e0b] transition-colors w-full justify-center min-h-[44px]"
        >
          <Plus size={16} />
          Generate New API Key
        </button>
      )}

      {/* Existing Keys List */}
      {!endpointAvailable ? (
        <div className="text-center py-6 text-xs text-[#a1a1aa]">
          <p>API key management not available yet.</p>
          <p className="mt-1">The backend endpoint <code className="font-mono text-[#f59e0b]">/api/v1/api-keys</code> is not implemented.</p>
        </div>
      ) : isLoading ? (
        <div className="text-center py-6 text-sm text-[#a1a1aa]">Loading keys…</div>
      ) : apiKeys.length === 0 ? (
        <div className="text-center py-6 text-xs text-[#a1a1aa]">
          No API keys yet. Create one to connect AI agents.
        </div>
      ) : (
        <div className="space-y-2">
          {apiKeys.map((key) => (
            <ApiKeyRow
              key={key.id}
              apiKey={key}
              onDelete={() => {
                if (confirm(`Revoke API key "${key.name}"? This cannot be undone.`)) {
                  deleteMutation.mutate(key.id);
                }
              }}
            />
          ))}
        </div>
      )}

      {/* Usage info */}
      <div className="mt-6 rounded-lg border border-[#262626] bg-[#0a0a0a] p-4">
        <h3 className="text-xs font-semibold text-[#fafafa] mb-2">Usage</h3>
        <div className="space-y-2 text-xs text-[#a1a1aa] font-mono">
          <p># Use the API key in requests:</p>
          <p className="text-[#fafafa]">curl -H "Authorization: Bearer baa_your_key_here" \</p>
          <p className="text-[#fafafa] pl-4">https://api.baaton.dev/api/v1/projects</p>
        </div>
      </div>
    </div>
  );
}

function ApiKeyRow({ apiKey, onDelete }: { apiKey: ApiKey; onDelete: () => void }) {
  const [showPrefix, setShowPrefix] = useState(false);

  return (
    <div className="flex items-center justify-between rounded-lg border border-[#262626] bg-[#0a0a0a] px-4 py-3 min-h-[44px]">
      <div className="flex items-center gap-3 min-w-0">
        <KeyRound size={16} className="text-[#a1a1aa] shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-[#fafafa] truncate">{apiKey.name}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <button
              onClick={() => setShowPrefix(!showPrefix)}
              className="text-[10px] font-mono text-[#a1a1aa] hover:text-[#fafafa] transition-colors flex items-center gap-1"
            >
              {showPrefix ? (
                <>
                  <EyeOff size={10} />
                  {apiKey.key_prefix}…
                </>
              ) : (
                <>
                  <Eye size={10} />
                  ••••••••
                </>
              )}
            </button>
            <span className="text-[10px] text-[#a1a1aa]">
              · created {timeAgo(apiKey.created_at)}
            </span>
            {apiKey.last_used_at && (
              <span className="text-[10px] text-[#a1a1aa] hidden sm:inline">
                · used {timeAgo(apiKey.last_used_at)}
              </span>
            )}
          </div>
        </div>
      </div>
      <button
        onClick={onDelete}
        className="rounded-md p-1.5 text-[#a1a1aa] hover:bg-red-500/10 hover:text-red-400 transition-all shrink-0"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
