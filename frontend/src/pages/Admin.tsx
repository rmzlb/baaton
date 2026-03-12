import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from '@/hooks/useTranslation';
import { useApi } from '@/hooks/useApi';
import {
  Shield, Users, Building2, FolderKanban, MessageSquare, Bot,
  Key, Zap, Webhook, Search, ChevronDown, Crown, Trash2,
  Plus, BarChart3, TrendingUp, Activity, RefreshCw, Copy,
  Check, AlertTriangle, ArrowUpDown,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────

interface OrgMember {
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  image_url: string;
  role: string;
}

interface OrgEntry {
  org_id: string;
  name: string;
  slug: string;
  plan: string;
  created_at: string;
  projects: number;
  issues: number;
  api_keys: number;
  automations: number;
  ai_messages_this_month: number;
  last_activity: string | null;
  members: OrgMember[];
}

interface PlatformOverview {
  totals: Record<string, number>;
  ai_usage_this_month: { messages: number; tokens_in: number; tokens_out: number; estimated_cost_usd: string };
  plan_distribution: { plan: string; count: number }[];
  daily_issues_30d: { date: string; count: number }[];
  top_orgs: { org_id: string; name: string; projects: number; issues: number }[];
}

interface SuperAdmin {
  user_id: string;
  email: string;
  granted_at: string;
  granted_by: string | null;
}

const PLAN_COLORS: Record<string, string> = {
  free: 'bg-zinc-500/20 text-zinc-400',
  pro: 'bg-blue-500/20 text-blue-400',
  enterprise: 'bg-purple-500/20 text-purple-400',
  partner: 'bg-green-500/20 text-green-400',
  tester: 'bg-amber-500/20 text-amber-400',
  unlimited: 'bg-red-500/20 text-red-400',
};

const VALID_PLANS = ['free', 'pro', 'enterprise', 'partner', 'tester', 'unlimited'];

// ─── Component ──────────────────────────────────────────────────────────

export default function Admin() {
  const { t } = useTranslation();
  const apiClient = useApi();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'overview' | 'orgs' | 'superadmins'>('overview');
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [sortBy, setSortBy] = useState<'issues' | 'projects' | 'created'>('issues');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [expandedOrg, setExpandedOrg] = useState<string | null>(null);

  // Check if current user is superadmin
  const { data: saCheck } = useQuery({
    queryKey: ['superadmin-check'],
    queryFn: async () => {
      const token = await apiClient._getToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'https://api.baaton.dev'}/api/v1/admin/superadmin/check`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      return json.data?.is_super_admin ?? false;
    },
  });

  const isSuperAdmin = saCheck === true;

  // Platform overview
  const { data: overview, isLoading: overviewLoading } = useQuery<PlatformOverview>({
    queryKey: ['admin-overview'],
    queryFn: async () => {
      const token = await apiClient._getToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'https://api.baaton.dev'}/api/v1/admin/overview`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      return json.data;
    },
    enabled: isSuperAdmin,
  });

  // Org list
  const { data: orgData, isLoading: orgsLoading } = useQuery<{ organizations: OrgEntry[]; total: number }>({
    queryKey: ['admin-users', planFilter],
    queryFn: async () => {
      const token = await apiClient._getToken();
      const params = new URLSearchParams({ limit: '200' });
      if (planFilter) params.set('plan', planFilter);
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'https://api.baaton.dev'}/api/v1/admin/users?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      return json.data;
    },
    enabled: isSuperAdmin,
  });

  // Super admins list
  const { data: superAdmins } = useQuery<SuperAdmin[]>({
    queryKey: ['superadmins'],
    queryFn: async () => {
      const token = await apiClient._getToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'https://api.baaton.dev'}/api/v1/admin/superadmins`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      return json.data;
    },
    enabled: isSuperAdmin,
  });

  // Set plan mutation
  const setPlanMut = useMutation({
    mutationFn: async ({ orgId, plan }: { orgId: string; plan: string }) => {
      const token = await apiClient._getToken();
      await fetch(`${import.meta.env.VITE_API_URL || 'https://api.baaton.dev'}/api/v1/admin/orgs/${orgId}/plan`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['admin-overview'] });
    },
  });

  // Add super admin
  const addSAMut = useMutation({
    mutationFn: async (email: string) => {
      const token = await apiClient._getToken();
      await fetch(`${import.meta.env.VITE_API_URL || 'https://api.baaton.dev'}/api/v1/admin/superadmins`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['superadmins'] });
      setNewAdminEmail('');
    },
  });

  // Remove super admin
  const removeSAMut = useMutation({
    mutationFn: async (email: string) => {
      const token = await apiClient._getToken();
      await fetch(`${import.meta.env.VITE_API_URL || 'https://api.baaton.dev'}/api/v1/admin/superadmins/${encodeURIComponent(email)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['superadmins'] }),
  });

  // Filter & sort orgs
  const filteredOrgs = useMemo(() => {
    if (!orgData?.organizations) return [];
    let list = orgData.organizations;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(o =>
        o.name.toLowerCase().includes(q) ||
        o.slug.toLowerCase().includes(q) ||
        o.members.some(m => m.email.toLowerCase().includes(q) || `${m.first_name} ${m.last_name}`.toLowerCase().includes(q))
      );
    }
    return [...list].sort((a, b) => {
      if (sortBy === 'issues') return b.issues - a.issues;
      if (sortBy === 'projects') return b.projects - a.projects;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [orgData, search, sortBy]);

  // Access denied
  if (saCheck === false) {
    return (
      <div className="p-4 md:p-6 flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Shield size={48} className="mx-auto mb-4 text-muted" />
          <h2 className="text-xl font-bold text-primary mb-2">{t('admin.accessDenied')}</h2>
          <p className="text-secondary">{t('admin.superadminRequired')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield size={24} className="text-red-400" />
          <h1 className="text-2xl font-bold text-primary">{t('admin.title')}</h1>
          <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-mono">SUPERADMIN</span>
        </div>
        <button onClick={() => { qc.invalidateQueries({ queryKey: ['admin-overview'] }); qc.invalidateQueries({ queryKey: ['admin-users'] }); }}
          className="p-2 rounded-lg hover:bg-surface-hover text-muted hover:text-primary transition-colors">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface rounded-lg p-1 w-fit">
        {(['overview', 'orgs', 'superadmins'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === t ? 'bg-surface-hover text-primary' : 'text-muted hover:text-secondary'}`}>
            {t === 'overview' ? '📊 Overview' : t === 'orgs' ? '🏢 Organizations' : '🛡️ Super Admins'}
          </button>
        ))}
      </div>

      {/* ─── Overview Tab ─────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="space-y-6">
          {overviewLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-24 bg-surface rounded-xl animate-pulse" />
              ))}
            </div>
          ) : overview && (
            <>
              {/* Stat cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { icon: Building2, label: t('admin.totalOrgs'), value: overview.totals.organizations, color: 'text-blue-400' },
                  { icon: FolderKanban, label: t('admin.totalProjects'), value: overview.totals.projects, color: 'text-green-400' },
                  { icon: Activity, label: t('admin.totalIssues'), value: overview.totals.issues, color: 'text-purple-400' },
                  { icon: MessageSquare, label: t('admin.totalComments'), value: overview.totals.comments, color: 'text-amber-400' },
                  { icon: Key, label: t('admin.totalApiKeys'), value: overview.totals.api_keys, color: 'text-cyan-400' },
                  { icon: Zap, label: t('admin.totalAutomations'), value: overview.totals.automations, color: 'text-orange-400' },
                  { icon: Webhook, label: t('admin.totalWebhooks'), value: overview.totals.webhooks, color: 'text-pink-400' },
                  { icon: Bot, label: t('admin.aiThisMonth'), value: overview.ai_usage_this_month.messages, color: 'text-indigo-400' },
                ].map(({ icon: Icon, label, value, color }) => (
                  <div key={label} className="bg-surface rounded-xl border border-border p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Icon size={16} className={color} />
                      <span className="text-xs text-muted">{label}</span>
                    </div>
                    <div className="text-2xl font-bold text-primary">{value.toLocaleString()}</div>
                  </div>
                ))}
              </div>

              {/* AI cost + plan distribution */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-surface rounded-xl border border-border p-5">
                  <h3 className="text-sm font-medium text-secondary mb-3 flex items-center gap-2">
                    <Bot size={16} /> {t('admin.aiCostTitle')}
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted">Tokens in</span><span className="text-primary font-mono">{overview.ai_usage_this_month.tokens_in.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-muted">Tokens out</span><span className="text-primary font-mono">{overview.ai_usage_this_month.tokens_out.toLocaleString()}</span></div>
                    <div className="flex justify-between border-t border-border pt-2"><span className="text-muted">{t('admin.estimatedCost')}</span><span className="text-green-400 font-bold">${overview.ai_usage_this_month.estimated_cost_usd}</span></div>
                  </div>
                </div>

                <div className="bg-surface rounded-xl border border-border p-5">
                  <h3 className="text-sm font-medium text-secondary mb-3 flex items-center gap-2">
                    <Crown size={16} /> {t('admin.planDistribution')}
                  </h3>
                  <div className="space-y-2">
                    {overview.plan_distribution.map(({ plan, count }) => (
                      <div key={plan} className="flex items-center justify-between">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PLAN_COLORS[plan] || PLAN_COLORS.free}`}>{plan}</span>
                        <span className="text-primary font-mono text-sm">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Daily issues chart (simple bar) */}
              {overview.daily_issues_30d.length > 0 && (
                <div className="bg-surface rounded-xl border border-border p-5">
                  <h3 className="text-sm font-medium text-secondary mb-3 flex items-center gap-2">
                    <TrendingUp size={16} /> {t('admin.dailyIssues30d')}
                  </h3>
                  <div className="flex items-end gap-px h-32">
                    {overview.daily_issues_30d.map(({ date, count }) => {
                      const max = Math.max(...overview.daily_issues_30d.map(d => d.count), 1);
                      const height = Math.max(2, (count / max) * 100);
                      return (
                        <div key={date} className="flex-1 flex flex-col items-center justify-end group relative">
                          <div className="absolute -top-6 hidden group-hover:block text-xs bg-surface-hover px-2 py-1 rounded text-primary whitespace-nowrap z-10">
                            {date.slice(5)}: {count}
                          </div>
                          <div className="w-full bg-accent/60 rounded-t-sm transition-all" style={{ height: `${height}%` }} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Top orgs */}
              {overview.top_orgs.length > 0 && (
                <div className="bg-surface rounded-xl border border-border p-5">
                  <h3 className="text-sm font-medium text-secondary mb-3 flex items-center gap-2">
                    <BarChart3 size={16} /> {t('admin.topOrgs')}
                  </h3>
                  <div className="space-y-2">
                    {overview.top_orgs.map((org, i) => (
                      <div key={org.org_id} className="flex items-center gap-3 text-sm">
                        <span className="text-muted w-6 text-right">{i + 1}.</span>
                        <span className="text-primary flex-1 truncate">{org.name}</span>
                        <span className="text-muted">{org.projects}p</span>
                        <span className="text-accent font-mono">{org.issues}i</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ─── Organizations Tab ────────────────────────────────────── */}
      {tab === 'orgs' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder={t('admin.searchOrgs')}
                className="w-full pl-9 pr-4 py-2 bg-surface border border-border rounded-lg text-sm text-primary placeholder-muted focus:outline-none focus:border-accent" />
            </div>
            <select value={planFilter} onChange={e => setPlanFilter(e.target.value)}
              className="px-3 py-2 bg-surface border border-border rounded-lg text-sm text-primary">
              <option value="">{t('admin.allPlans')}</option>
              {VALID_PLANS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <button onClick={() => setSortBy(s => s === 'issues' ? 'projects' : s === 'projects' ? 'created' : 'issues')}
              className="flex items-center gap-1 px-3 py-2 bg-surface border border-border rounded-lg text-sm text-secondary hover:text-primary">
              <ArrowUpDown size={14} /> {sortBy}
            </button>
          </div>

          {/* Count */}
          <div className="text-xs text-muted">
            {filteredOrgs.length} {t('admin.orgsFound')} {orgData?.total ? `/ ${orgData.total} total` : ''}
          </div>

          {/* Org list */}
          {orgsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-20 bg-surface rounded-xl animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredOrgs.map(org => (
                <div key={org.org_id} className="bg-surface rounded-xl border border-border overflow-hidden">
                  {/* Header row */}
                  <div className="p-4 flex items-center gap-4 cursor-pointer hover:bg-surface-hover transition-colors"
                    onClick={() => setExpandedOrg(expandedOrg === org.org_id ? null : org.org_id)}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-primary truncate">{org.name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PLAN_COLORS[org.plan] || PLAN_COLORS.free}`}>{org.plan}</span>
                      </div>
                      <div className="text-xs text-muted mt-1">{org.slug} · {org.members.length} {t('admin.members')}</div>
                    </div>
                    <div className="hidden md:flex items-center gap-4 text-xs text-muted">
                      <span>{org.projects}p</span>
                      <span>{org.issues}i</span>
                      <span>{org.api_keys}k</span>
                      <span>{org.ai_messages_this_month} AI</span>
                    </div>
                    {/* Plan selector */}
                    <select
                      value={org.plan}
                      onClick={e => e.stopPropagation()}
                      onChange={e => setPlanMut.mutate({ orgId: org.org_id, plan: e.target.value })}
                      className="text-xs px-2 py-1 bg-transparent border border-border rounded text-primary">
                      {VALID_PLANS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <ChevronDown size={16} className={`text-muted transition-transform ${expandedOrg === org.org_id ? 'rotate-180' : ''}`} />
                  </div>

                  {/* Expanded details */}
                  {expandedOrg === org.org_id && (
                    <div className="border-t border-border p-4 space-y-3">
                      {/* Stats */}
                      <div className="grid grid-cols-3 md:grid-cols-6 gap-3 text-center">
                        {[
                          { label: t('admin.projects'), value: org.projects },
                          { label: t('admin.issues'), value: org.issues },
                          { label: t('admin.apiKeysShort'), value: org.api_keys },
                          { label: t('admin.automationsShort'), value: org.automations },
                          { label: 'AI/mo', value: org.ai_messages_this_month },
                          { label: t('admin.lastActivity'), value: org.last_activity ? new Date(org.last_activity).toLocaleDateString() : '—' },
                        ].map(s => (
                          <div key={s.label} className="bg-black/20 rounded-lg p-2">
                            <div className="text-lg font-bold text-primary">{typeof s.value === 'number' ? s.value.toLocaleString() : s.value}</div>
                            <div className="text-xs text-muted">{s.label}</div>
                          </div>
                        ))}
                      </div>

                      {/* Members */}
                      {org.members.length > 0 && (
                        <div>
                          <h4 className="text-xs font-medium text-muted mb-2">{t('admin.members')}</h4>
                          <div className="space-y-1">
                            {org.members.map(m => (
                              <div key={m.user_id} className="flex items-center gap-2 text-sm">
                                {m.image_url ? (
                                  <img src={m.image_url} className="w-5 h-5 rounded-full" alt="" />
                                ) : (
                                  <div className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center text-xs text-accent">
                                    {(m.first_name || m.email)[0]?.toUpperCase()}
                                  </div>
                                )}
                                <span className="text-primary">{m.first_name} {m.last_name}</span>
                                <span className="text-muted text-xs">{m.email}</span>
                                <span className="text-xs px-1.5 py-0.5 rounded bg-surface-hover text-muted">{m.role}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Org ID (copyable) */}
                      <div className="flex items-center gap-2 text-xs text-muted">
                        <span>ID: <code className="font-mono">{org.org_id}</code></span>
                        <CopyButton text={org.org_id} />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Super Admins Tab ─────────────────────────────────────── */}
      {tab === 'superadmins' && (
        <div className="space-y-4">
          <div className="bg-surface rounded-xl border border-border p-5">
            <h3 className="text-sm font-medium text-secondary mb-4 flex items-center gap-2">
              <Shield size={16} className="text-red-400" /> {t('admin.superadminList')}
            </h3>

            {/* Add new */}
            <div className="flex gap-2 mb-4">
              <input value={newAdminEmail} onChange={e => setNewAdminEmail(e.target.value)}
                placeholder="email@example.com"
                className="flex-1 px-3 py-2 bg-black/20 border border-border rounded-lg text-sm text-primary placeholder-muted focus:outline-none focus:border-accent"
                onKeyDown={e => { if (e.key === 'Enter' && newAdminEmail) addSAMut.mutate(newAdminEmail); }} />
              <button onClick={() => newAdminEmail && addSAMut.mutate(newAdminEmail)}
                disabled={!newAdminEmail || addSAMut.isPending}
                className="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg text-sm font-medium hover:bg-red-500/30 disabled:opacity-50 flex items-center gap-1">
                <Plus size={14} /> {t('admin.addSuperadmin')}
              </button>
            </div>

            {/* List */}
            <div className="space-y-2">
              {superAdmins?.map(sa => (
                <div key={sa.email} className="flex items-center justify-between p-3 bg-black/20 rounded-lg">
                  <div>
                    <div className="text-sm text-primary">{sa.email}</div>
                    <div className="text-xs text-muted">
                      {t('admin.grantedAt')} {new Date(sa.granted_at).toLocaleDateString()}
                      {sa.granted_by && ` · by ${sa.granted_by}`}
                    </div>
                  </div>
                  <button onClick={() => removeSAMut.mutate(sa.email)}
                    className="p-1.5 rounded hover:bg-red-500/20 text-muted hover:text-red-400 transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              )) || <div className="text-sm text-muted">{t('admin.noSuperadmins')}</div>}
            </div>
          </div>

          {/* Warning */}
          <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
            <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
            <div className="text-sm text-amber-300">
              {t('admin.superadminWarning')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Copy button ────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="p-0.5 rounded hover:bg-surface-hover text-muted hover:text-primary">
      {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
    </button>
  );
}
