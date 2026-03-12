import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { Crown, Zap, Building2, Check, ArrowRight, Loader2, FolderKanban, FileText, Globe } from 'lucide-react';

interface OrgUsage {
  org_id: string;
  org_name: string;
  project_count: number;
  issue_count: number;
}

interface BillingData {
  plan: string;
  organizations: OrgUsage[];
  usage: {
    orgs: { current: number; limit: number };
    projects: { current: number; limit: number };
    issues: { current: number; limit: number };
    api_requests: { current: number; limit: number; month: string };
  };
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

  return (
    <div className="p-4 md:p-6 max-w-5xl">
      <h1 className="text-2xl font-bold text-primary mb-1">{t('billing.title')}</h1>
      <p className="text-sm text-muted mb-8">{t('billing.subtitle')}</p>

      {/* Usage overview */}
      {billing && (
        <div className="rounded-xl border border-border bg-surface p-6 mb-6">
          <h2 className="text-sm font-semibold text-primary mb-4">{t('billing.currentUsage')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <UsageBar
              current={billing.usage.orgs.current}
              limit={billing.usage.orgs.limit}
              label={t('billing.organizations')}
            />
            <UsageBar
              current={billing.usage.projects.current}
              limit={billing.usage.projects.limit}
              label={t('billing.projects')}
            />
            <UsageBar
              current={billing.usage.issues.current}
              limit={billing.usage.issues.limit}
              label={t('billing.issues')}
            />
            <UsageBar
              current={billing.usage.api_requests.current}
              limit={billing.usage.api_requests.limit}
              label={`${t('billing.apiRequests')} (${billing.usage.api_requests.month})`}
            />
          </div>
        </div>
      )}

      {/* Per-org breakdown */}
      {billing && billing.organizations.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-6 mb-8">
          <h2 className="text-sm font-semibold text-primary mb-4">{t('billing.orgBreakdown')}</h2>
          <div className="space-y-3">
            {billing.organizations.map((org) => (
              <div
                key={org.org_id}
                className="flex items-center justify-between rounded-lg border border-border bg-background px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <Globe size={16} className="text-muted" />
                  <span className="text-sm font-medium text-primary">{org.org_name}</span>
                </div>
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-1.5 text-xs text-secondary">
                    <FolderKanban size={12} className="text-muted" />
                    {org.project_count} {t('billing.projectsShort')}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-secondary">
                    <FileText size={12} className="text-muted" />
                    {org.issue_count.toLocaleString()} {t('billing.issuesShort')}
                  </div>
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
