import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { Crown, Zap, Building2, Check, ArrowRight, Loader2, FolderKanban, FileText, Globe } from 'lucide-react';

type PlanSource = 'org' | 'owner' | 'none';

interface OrgUsage {
  org_id: string;
  org_name: string;
  /** The org's own plan and the plan that governs it (own plan raised to the owner's). */
  plan: string;
  effective_plan: string;
  plan_source: PlanSource;
  owner_is_me: boolean;
  is_current: boolean;
  project_count: number;
  issue_count: number;
}

interface ProjectUsage {
  project_id: string;
  name: string;
  prefix: string;
  issue_count: number;
  open_count: number;
}

interface BillingData {
  /** Plan that governs the caller in the current organization. */
  plan: string;
  plan_org_id: string;
  current_org: {
    org_id: string;
    org_name: string;
    plan: string;
    effective_plan: string;
    plan_source: PlanSource;
    owner_user_id: string | null;
    owner_is_me: boolean;
    projects: ProjectUsage[];
  };
  /** Present when the free allowance is shared across the owner's free organizations. */
  free_pool: { org_ids: string[]; org_names: string[] } | null;
  organizations: OrgUsage[];
  usage: {
    orgs: { current: number; limit: number };
    projects: { current: number; limit: number };
    issues: { current: number; limit: number };
    api_requests: { current: number; limit: number; month: string };
    ai_messages: { current: number; limit: number; month: string };
    api_keys: { current: number; limit: number };
    automations: { current: number; limit: number };
    users: { limit: number };
  };
}

const PLAN_BADGE: Record<string, string> = {
  free: 'bg-zinc-500/10 text-zinc-300',
  pro: 'bg-blue-500/10 text-blue-300',
  enterprise: 'bg-purple-500/10 text-purple-300',
  partner: 'bg-emerald-500/10 text-emerald-300',
  tester: 'bg-amber-500/10 text-amber-300',
  unlimited: 'bg-red-500/10 text-red-300',
};

function PlanBadge({ plan }: { plan: string }) {
  return (
    <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium', PLAN_BADGE[plan] ?? PLAN_BADGE.free)}>
      {plan}
    </span>
  );
}

const PLANS = [
  {
    key: 'free',
    icon: Zap,
    color: 'text-gray-400',
    bg: 'bg-gray-500/10 border-gray-500/20',
    features: ['billing.free.f1', 'billing.free.f2', 'billing.free.f3', 'billing.free.f4', 'billing.free.f5'],
  },
  {
    key: 'pro',
    icon: Crown,
    color: 'text-accent',
    bg: 'bg-accent/10 border-accent/20',
    popular: true,
    features: ['billing.pro.f1', 'billing.pro.f2', 'billing.pro.f3', 'billing.pro.f4', 'billing.pro.f5'],
  },
  {
    key: 'enterprise',
    icon: Building2,
    color: 'text-purple-400',
    bg: 'bg-purple-500/10 border-purple-500/20',
    features: ['billing.enterprise.f1', 'billing.enterprise.f2', 'billing.enterprise.f3', 'billing.enterprise.f4', 'billing.enterprise.f5'],
  },
];

function UsageBar({ current, limit, label }: { current: number; limit: number; label: string }) {
  const unlimited = limit < 0;
  const pct = unlimited ? 0 : Math.min((current / Math.max(limit, 1)) * 100, 100);
  const isNearLimit = !unlimited && pct >= 80;
  const isAtLimit = !unlimited && pct >= 100;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-secondary">{label}</span>
        <span className={cn('text-xs font-mono', isAtLimit ? 'text-red-400' : isNearLimit ? 'text-amber-400' : 'text-muted')}>
          {current.toLocaleString()} / {unlimited ? '∞' : limit.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-hover overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            isAtLimit ? 'bg-red-500' : isNearLimit ? 'bg-amber-500' : 'bg-accent',
          )}
          style={{ width: unlimited ? '5%' : `${Math.max(pct, 2)}%` }}
        />
      </div>
    </div>
  );
}

export function Billing() {
  const { t } = useTranslation();
  const apiClient = useApi();

  const { data: billing, isLoading } = useQuery({
    queryKey: ['billing'],
    queryFn: () => apiClient.get<BillingData>('/billing'),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={24} className="animate-spin text-muted" />
      </div>
    );
  }

  const currentPlan = billing?.plan || 'free';
  const currentOrg = billing?.current_org;
  const planSourceLabel =
    currentOrg?.plan_source === 'owner'
      ? currentOrg.owner_is_me
        ? t('billing.planSource.ownerMe')
        : t('billing.planSource.owner')
      : currentOrg?.plan_source === 'org'
        ? t('billing.planSource.org')
        : t('billing.planSource.none');

  return (
    <div className="p-4 md:p-6">
      <h1 className="text-2xl font-bold text-primary mb-1">{t('billing.title')}</h1>
      <p className="text-sm text-muted mb-8">{t('billing.subtitle')}</p>

      {/* Current organization: plan, where it comes from, usage — one surface */}
      {billing && currentOrg && (
        <div className="rounded-xl border border-border bg-surface mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
            <div className="flex items-center gap-3 min-w-0">
              <Globe size={16} className="text-muted shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted">{t('billing.currentOrg')}</div>
                <div className="text-sm font-semibold text-primary truncate">{currentOrg.org_name}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted">
              <PlanBadge plan={currentOrg.effective_plan} />
              <span>{planSourceLabel}</span>
            </div>
          </div>
          <div className="border-t border-border" />
          <div className="px-6 py-4">
            <h2 className="text-[10px] font-medium uppercase tracking-wider text-muted mb-4">{t('billing.currentUsage')}</h2>
            {billing.free_pool && (
              <p className="mb-4 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                {t('billing.freePoolNote', { count: billing.free_pool.org_names.length })}{' '}
                <span className="text-amber-300/80">{billing.free_pool.org_names.join(' · ')}</span>
              </p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <UsageBar current={billing.usage.projects.current} limit={billing.usage.projects.limit} label={t('billing.projects')} />
              <UsageBar current={billing.usage.issues.current} limit={billing.usage.issues.limit} label={t('billing.issues')} />
              <UsageBar
                current={billing.usage.api_requests.current}
                limit={billing.usage.api_requests.limit}
                label={`${t('billing.apiRequests')} (${billing.usage.api_requests.month})`}
              />
              <UsageBar
                current={billing.usage.ai_messages?.current ?? 0}
                limit={billing.usage.ai_messages?.limit ?? 50}
                label={`${t('billing.aiMessages')} (${billing.usage.ai_messages?.month ?? ''})`}
              />
              <UsageBar current={billing.usage.api_keys?.current ?? 0} limit={billing.usage.api_keys?.limit ?? 3} label={t('billing.apiKeys')} />
              <UsageBar current={billing.usage.automations?.current ?? 0} limit={billing.usage.automations?.limit ?? 3} label={t('billing.automations')} />
            </div>
          </div>
          <div className="border-t border-border" />
          <div className="px-6 py-4">
            <h2 className="text-[10px] font-medium uppercase tracking-wider text-muted mb-3">{t('billing.perProject')}</h2>
            {currentOrg.projects.length === 0 ? (
              <p className="text-xs text-muted">{t('billing.noProjects')}</p>
            ) : (
              <div className="divide-y divide-border">
                {currentOrg.projects.map((project, i) => (
                  <div
                    key={project.project_id}
                    className="animate-row-in flex items-center justify-between py-2.5 text-sm"
                    style={{ '--row-index': i } as React.CSSProperties}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <FolderKanban size={14} className="text-muted shrink-0" />
                      <span className="font-medium text-primary truncate">{project.name}</span>
                      <span className="font-mono text-[11px] text-muted">{project.prefix}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-secondary tabular-nums">
                      <span>{project.issue_count.toLocaleString()} {t('billing.issuesShort')}</span>
                      <span className="text-muted">{project.open_count.toLocaleString()} {t('billing.openIssues')}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Every organization the caller belongs to, each with its own plan */}
      {billing && billing.organizations.length > 0 && (
        <div className="rounded-xl border border-border bg-surface mb-8">
          <div className="px-6 py-4">
            <h2 className="text-[10px] font-medium uppercase tracking-wider text-muted">{t('billing.yourOrgs')}</h2>
            <p className="mt-1 text-xs text-muted">{t('billing.yourOrgsHint')}</p>
          </div>
          <div className="border-t border-border" />
          <div className="divide-y divide-border px-6">
            {billing.organizations.map((org, i) => (
              <div
                key={org.org_id}
                className="animate-row-in flex flex-wrap items-center justify-between gap-3 py-3"
                style={{ '--row-index': i } as React.CSSProperties}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Globe size={14} className="text-muted shrink-0" />
                  <span className="text-sm font-medium text-primary truncate">{org.org_name}</span>
                  {org.is_current && (
                    <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">{t('billing.current')}</span>
                  )}
                  {org.owner_is_me && (
                    <span className="text-[10px] text-muted">{t('billing.owner')}</span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs text-secondary tabular-nums">
                  <PlanBadge plan={org.effective_plan} />
                  <span className="flex items-center gap-1.5">
                    <FolderKanban size={12} className="text-muted" />
                    {org.project_count} {t('billing.projectsShort')}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <FileText size={12} className="text-muted" />
                    {org.issue_count.toLocaleString()} {t('billing.issuesShort')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Plan cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PLANS.map((plan) => {
          const Icon = plan.icon;
          const isCurrent = currentPlan === plan.key;

          return (
            <div
              key={plan.key}
              className={cn(
                'relative rounded-xl border p-6 transition-all',
                isCurrent
                  ? `${plan.bg} ring-2 ring-accent/30`
                  : 'border-border bg-surface hover:border-accent/30',
              )}
            >
              {plan.popular && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-0.5 text-[10px] font-bold text-black uppercase tracking-wider">
                  {t('billing.popular')}
                </span>
              )}

              <div className="flex items-center gap-3 mb-4">
                <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', plan.bg)}>
                  <Icon size={20} className={plan.color} />
                </div>
                <div>
                  <h3 className="font-semibold text-primary capitalize">{t(`billing.plan.${plan.key}`)}</h3>
                  <p className="text-xs text-muted">{t(`billing.plan.${plan.key}.price`)}</p>
                </div>
              </div>

              <ul className="space-y-2 mb-6">
                {plan.features.map((fKey) => (
                  <li key={fKey} className="flex items-start gap-2 text-xs text-secondary">
                    <Check size={14} className={cn('shrink-0 mt-0.5', isCurrent ? 'text-accent' : 'text-muted')} />
                    <span>{t(fKey)}</span>
                  </li>
                ))}
              </ul>

              {isCurrent ? (
                <div className="rounded-lg bg-accent/10 border border-accent/20 px-4 py-2 text-center text-xs font-medium text-accent">
                  {t('billing.currentPlan')}
                </div>
              ) : (
                <button
                  className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-border px-4 py-2 text-xs font-medium text-secondary hover:text-primary hover:bg-surface-hover transition-colors"
                >
                  {t('billing.upgrade')}
                  <ArrowRight size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-muted text-center mt-6">
        {t('billing.contactEnterprise')}
      </p>
    </div>
  );
}

export default Billing;
