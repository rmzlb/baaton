import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrganization, useOrganizationList } from '@clerk/clerk-react';
import {
  Plus, Trash2, Copy, CheckCircle2, AlertTriangle, BookOpen,
  RefreshCw, Key, X, ChevronDown, Pencil, Shield, Zap, Bot,
  GitBranch, Eye, EyeOff,
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { timeAgo } from '@/lib/utils';
import type { ApiKey } from '@/lib/types';

// ─── Permission definitions ─────────────────────────────────────────────────

const PERMISSION_GROUPS = [
  {
    key: 'issues',
    perms: ['issues:read', 'issues:write', 'issues:delete'],
    color: 'bg-blue-500/15 text-blue-600 border-blue-500/25',
  },
  {
    key: 'projects',
    perms: ['projects:read', 'projects:write', 'projects:delete'],
    color: 'bg-purple-500/15 text-purple-600 border-purple-500/25',
  },
  {
    key: 'comments',
    perms: ['comments:read', 'comments:write', 'comments:delete'],
    color: 'bg-cyan-500/15 text-cyan-600 border-cyan-500/25',
  },
  {
    key: 'labels',
    perms: ['labels:read', 'labels:write'],
    color: 'bg-pink-500/15 text-pink-600 border-pink-500/25',
  },
  {
    key: 'milestones',
    perms: ['milestones:read', 'milestones:write'],
    color: 'bg-indigo-500/15 text-indigo-600 border-indigo-500/25',
  },
  {
    key: 'sprints',
    perms: ['sprints:read', 'sprints:write'],
    color: 'bg-violet-500/15 text-violet-600 border-violet-500/25',
  },
  {
    key: 'automations',
    perms: ['automations:read', 'automations:write'],
    color: 'bg-orange-500/15 text-orange-600 border-orange-500/25',
  },
  {
    key: 'webhooks',
    perms: ['webhooks:read', 'webhooks:write'],
    color: 'bg-teal-500/15 text-teal-600 border-teal-500/25',
  },
  {
    key: 'members',
    perms: ['members:read', 'members:invite'],
    color: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/25',
  },
  {
    key: 'context',
    perms: ['context:read', 'context:write'],
    color: 'bg-sky-500/15 text-sky-600 border-sky-500/25',
  },
  {
    key: 'templates',
    perms: ['templates:read', 'templates:write'],
    color: 'bg-fuchsia-500/15 text-fuchsia-600 border-fuchsia-500/25',
  },
  {
    key: 'ai',
    perms: ['ai:chat', 'ai:triage'],
    color: 'bg-amber-500/15 text-amber-600 border-amber-500/25',
  },
  {
    key: 'billing',
    perms: ['billing:read'],
    color: 'bg-lime-500/15 text-lime-600 border-lime-500/25',
  },
  {
    key: 'admin',
    perms: ['admin:full'],
    color: 'bg-red-500/15 text-red-600 border-red-500/25',
  },
] as const;

// Map perm → group color for badges
const PERM_COLOR: Record<string, string> = {};
for (const g of PERMISSION_GROUPS) {
  for (const p of g.perms) {
    PERM_COLOR[p] = g.color;
  }
}

const PRESETS: Record<string, string[]> = {
  readOnly: [
    'issues:read', 'projects:read', 'comments:read',
    'labels:read', 'milestones:read', 'sprints:read', 'members:read',
  ],
  fullAccess: [
    'issues:read', 'issues:write', 'issues:delete',
    'projects:read', 'projects:write',
    'comments:read', 'comments:write',
    'labels:read', 'labels:write',
    'milestones:read', 'milestones:write',
    'sprints:read', 'sprints:write',
    'automations:read', 'automations:write',
    'webhooks:read', 'webhooks:write',
    'members:read', 'members:invite',
    'context:read', 'context:write',
    'templates:read', 'templates:write',
    'ai:chat', 'ai:triage',
    'billing:read',
  ],
  agent: [
    'issues:read', 'issues:write', 'issues:delete',
    'projects:read',
    'comments:read', 'comments:write',
    'labels:read',
    'milestones:read',
    'context:read', 'context:write',
    'templates:read',
    'ai:chat', 'ai:triage',
  ],
  cicd: [
    'issues:read', 'issues:write',
    'projects:read',
    'webhooks:read', 'webhooks:write',
    'labels:read',
  ],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function formatExpiry(expires_at: string | null): string {
  if (!expires_at) return '—';
  const d = new Date(expires_at);
  const now = new Date();
  if (d < now) return '⚠ Expired';
  return d.toLocaleDateString();
}

type OrgScopeMode = 'current' | 'selected' | 'all';

type OrgOption = {
  id: string;
  name: string;
  slug?: string;
};

type ProjectOption = {
  id: string;
  name: string;
  slug: string;
  org_id: string;
};

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function getEffectiveOrgIds(
  mode: OrgScopeMode,
  activeOrgId: string | null,
  selectedOrgIds: string[],
  organizations: OrgOption[],
): string[] {
  if (mode === 'all') return uniqueStrings(organizations.map(org => org.id));
  if (mode === 'current') return activeOrgId ? [activeOrgId] : organizations[0] ? [organizations[0].id] : [];
  return uniqueStrings(selectedOrgIds);
}

function isAllCurrentOrganizations(orgIds: string[], organizations: OrgOption[]): boolean {
  const left = uniqueStrings(orgIds).sort();
  const right = uniqueStrings(organizations.map(org => org.id)).sort();
  return right.length > 0 && left.length === right.length && left.every((id, i) => id === right[i]);
}

function getOrgScopeLabel(
  apiKey: ApiKey,
  organizations: OrgOption[],
  t: (k: string, opts?: any) => string,
): string {
  const scopedOrgIds = uniqueStrings(apiKey.org_ids?.length ? apiKey.org_ids : [apiKey.org_id]);

  if (isAllCurrentOrganizations(scopedOrgIds, organizations)) {
    return t('apiKeys.orgScopeAllCurrent');
  }

  if (scopedOrgIds.length <= 1) {
    const orgId = scopedOrgIds[0] ?? apiKey.org_id;
    return organizations.find(org => org.id === orgId)?.name ?? apiKey.org_name ?? orgId;
  }

  return t('apiKeys.orgScopeMultiple', { count: scopedOrgIds.length });
}

function groupProjectsByOrg(projects: ProjectOption[], organizations: OrgOption[]) {
  const orgMap = new Map(organizations.map(org => [org.id, org]));
  const groups = new Map<string, ProjectOption[]>();

  for (const project of projects) {
    const current = groups.get(project.org_id) ?? [];
    current.push(project);
    groups.set(project.org_id, current);
  }

  return Array.from(groups.entries())
    .map(([orgId, orgProjects]) => ({
      orgId,
      orgName: orgMap.get(orgId)?.name ?? orgId,
      projects: [...orgProjects].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.orgName.localeCompare(b.orgName));
}

function getOrgNames(orgIds: string[], organizations: OrgOption[]): string[] {
  const orgMap = new Map(organizations.map(org => [org.id, org.name]));
  return uniqueStrings(orgIds).map(orgId => orgMap.get(orgId) ?? orgId);
}

function PermBadge({ perm, t, compact }: { perm: string; t: (k: string) => string; compact?: boolean }) {
  const color = PERM_COLOR[perm] ?? 'bg-zinc-500/15 text-zinc-600 border-zinc-500/25';
  const colonIdx = perm.indexOf(':');
  // Graceful fallback for malformed/unknown perm strings (no colon or old data)
  if (colonIdx === -1) {
    return (
      <span className="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium bg-zinc-500/15 text-zinc-600 border-zinc-500/25">
        {perm}
      </span>
    );
  }
  const group = perm.slice(0, colonIdx);
  const action = perm.slice(colonIdx + 1);
  const groupLabel = t(`apiKeys.permGroup.${group}` as any) || group;
  const actionLabel = t(`apiKeys.perm.${perm}` as any) || action;
  // Compact: "Issues:R" — Full: "Issues: Read"
  const label = compact
    ? `${groupLabel}:${action[0]?.toUpperCase() ?? '?'}`
    : `${groupLabel}: ${actionLabel}`;
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${color}`}>
      {label}
    </span>
  );
}

// ─── Permission grid (shared between create modal and edit drawer) ───────────

function PermissionGrid({
  selected,
  onChange,
  t,
}: {
  selected: string[];
  onChange: (perms: string[]) => void;
  t: (k: string, opts?: any) => string;
}) {
  const toggle = (perm: string) => {
    onChange(
      selected.includes(perm) ? selected.filter(p => p !== perm) : [...selected, perm],
    );
  };

  return (
    <div className="space-y-3">
      {PERMISSION_GROUPS.map(group => (
        <div key={group.key}>
          <p className="text-xs font-semibold text-secondary uppercase tracking-wider mb-1.5">
            {t(`apiKeys.permGroup.${group.key}` as any)}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {group.perms.map(perm => {
              const active = selected.includes(perm);
              const color = group.color;
              return (
                <button
                  key={perm}
                  type="button"
                  onClick={() => toggle(perm)}
                  className={`rounded-md border px-2 py-1 text-xs font-medium transition-all ${
                    active
                      ? color
                      : 'border-border text-muted hover:border-border hover:text-secondary'
                  }`}
                >
                  {t(`apiKeys.perm.${perm}` as any)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Create Key Modal ────────────────────────────────────────────────────────

type ExpiryOption = 'never' | '30d' | '90d' | '1y' | 'custom';

interface CreateModalProps {
  onClose: () => void;
  onCreated: (key: ApiKey & { key: string }) => void;
  projects: ProjectOption[];
  organizations: OrgOption[];
  activeOrgId: string | null;
}

function CreateModal({ onClose, onCreated, projects, organizations, activeOrgId }: CreateModalProps) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const [name, setName] = useState('');
  const [orgScopeMode, setOrgScopeMode] = useState<OrgScopeMode>(organizations.length > 1 ? 'selected' : 'current');
  const [scopeAll, setScopeAll] = useState(true);
  const [selectedOrgIds, setSelectedOrgIds] = useState<string[]>(activeOrgId ? [activeOrgId] : []);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<string[]>(PRESETS.agent);
  const [expiry, setExpiry] = useState<ExpiryOption>('never');
  const [customDate, setCustomDate] = useState('');

  const effectiveOrgIds = useMemo(
    () => getEffectiveOrgIds(orgScopeMode, activeOrgId, selectedOrgIds, organizations),
    [orgScopeMode, activeOrgId, selectedOrgIds, organizations],
  );

  const visibleProjects = useMemo(
    () => projects.filter(project => effectiveOrgIds.includes(project.org_id)),
    [projects, effectiveOrgIds],
  );

  const visibleProjectGroups = useMemo(
    () => groupProjectsByOrg(visibleProjects, organizations),
    [visibleProjects, organizations],
  );

  const effectiveOrgNames = useMemo(
    () => getOrgNames(effectiveOrgIds, organizations),
    [effectiveOrgIds, organizations],
  );

  useEffect(() => {
    if (!activeOrgId) return;
    setSelectedOrgIds(prev => (prev.length > 0 ? prev : [activeOrgId]));
  }, [activeOrgId]);

  useEffect(() => {
    const visibleIds = new Set(visibleProjects.map(project => project.id));
    setSelectedProjects(prev => prev.filter(id => visibleIds.has(id)));
  }, [visibleProjects]);

  const createMutation = useMutation({
    mutationFn: () => {
      let expires_at: string | undefined;
      if (expiry === '30d') expires_at = addDays(30);
      else if (expiry === '90d') expires_at = addDays(90);
      else if (expiry === '1y') expires_at = addDays(365);
      else if (expiry === 'custom' && customDate) expires_at = new Date(customDate).toISOString();

      return apiClient.apiKeys.create({
        name: name.trim(),
        permissions,
        org_ids: effectiveOrgIds,
        project_ids: scopeAll ? [] : selectedProjects,
        expires_at: expires_at ?? null,
      });
    },
    onSuccess: (data) => {
      onCreated(data);
    },
  });

  const applyPreset = (preset: keyof typeof PRESETS) => {
    setPermissions(PRESETS[preset]);
  };

  const toggleProject = (id: string) => {
    setSelectedProjects(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id],
    );
  };

  const toggleOrg = (id: string) => {
    setSelectedOrgIds(prev =>
      prev.includes(id) ? prev.filter(orgId => orgId !== id) : [...prev, id],
    );
  };

  const EXPIRY_OPTIONS: { value: ExpiryOption; labelKey: string }[] = [
    { value: 'never', labelKey: 'apiKeys.createModal.expNever' },
    { value: '30d', labelKey: 'apiKeys.createModal.exp30' },
    { value: '90d', labelKey: 'apiKeys.createModal.exp90' },
    { value: '1y', labelKey: 'apiKeys.createModal.exp1y' },
    { value: 'custom', labelKey: 'apiKeys.createModal.expCustom' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-border bg-surface shadow-2xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Key size={18} className="text-accent" />
            <h2 className="text-base font-semibold text-primary">
              {t('apiKeys.createModal.title')}
            </h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-primary transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-secondary uppercase tracking-wider mb-1.5">
              {t('apiKeys.col.name')}
            </label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('apiKeys.createModal.namePlaceholder')}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder-muted focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-secondary uppercase tracking-wider mb-1.5">
              {t('apiKeys.createModal.orgScope')}
            </label>
            <p className="text-xs text-muted mb-2">
              {t('apiKeys.createModal.orgScopeHelp')}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 mb-2">
              <button
                type="button"
                onClick={() => setOrgScopeMode('current')}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                  orgScopeMode === 'current'
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-secondary hover:border-border hover:text-primary'
                }`}
              >
                {t('apiKeys.createModal.orgScopeCurrent')}
              </button>
              <button
                type="button"
                onClick={() => setOrgScopeMode('selected')}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                  orgScopeMode === 'selected'
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-secondary hover:border-border hover:text-primary'
                }`}
              >
                {t('apiKeys.createModal.orgScopeSelected')}
              </button>
              <button
                type="button"
                onClick={() => setOrgScopeMode('all')}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                  orgScopeMode === 'all'
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-secondary hover:border-border hover:text-primary'
                }`}
              >
                {t('apiKeys.createModal.orgScopeAllCurrent')}
              </button>
            </div>
            {orgScopeMode === 'selected' && organizations.length > 0 && (
              <div className="flex flex-wrap gap-1.5 p-3 rounded-lg border border-border bg-bg">
                {organizations.map(org => (
                  <button
                    key={org.id}
                    type="button"
                    onClick={() => toggleOrg(org.id)}
                    className={`rounded-md border px-2 py-1 text-xs font-medium transition-all ${
                      selectedOrgIds.includes(org.id)
                        ? 'border-accent bg-accent/15 text-accent'
                        : 'border-border text-muted hover:text-secondary'
                    }`}
                  >
                    {org.name}
                  </button>
                ))}
              </div>
            )}
            {orgScopeMode === 'all' && (
              <p className="text-xs text-muted mt-2">
                {t('apiKeys.createModal.orgScopeAllCurrentHelp')}
              </p>
            )}
            <div className="mt-3 rounded-lg border border-border bg-bg px-3 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-secondary">
                {t('apiKeys.createModal.orgTargets')}
              </div>
              {effectiveOrgNames.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {effectiveOrgNames.map(name => (
                    <span key={name} className="rounded-md border border-accent/20 bg-accent/10 px-2 py-1 text-xs font-medium text-accent">
                      {name}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted">{t('apiKeys.createModal.orgTargetsEmpty')}</p>
              )}
              {scopeAll && effectiveOrgNames.length > 0 && (
                <p className="mt-2 text-xs text-muted">{t('apiKeys.createModal.scopeAllAppliesHelp')}</p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-secondary uppercase tracking-wider mb-1.5">
              {t('apiKeys.createModal.projectScope')}
            </label>
            <p className="text-xs text-muted mb-2">
              {t('apiKeys.createModal.projectScopeHelp')}
            </p>
            <div className="flex gap-2 mb-2">
              <button
                type="button"
                onClick={() => setScopeAll(true)}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                  scopeAll
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-secondary hover:border-border hover:text-primary'
                }`}
              >
                {t('apiKeys.createModal.scopeAll')}
              </button>
              <button
                type="button"
                onClick={() => setScopeAll(false)}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                  !scopeAll
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-secondary hover:border-border hover:text-primary'
                }`}
              >
                {t('apiKeys.createModal.scopeSpecific')}
              </button>
            </div>
            {!scopeAll && visibleProjects.length > 0 && (
              <div className="space-y-3 p-3 rounded-lg border border-border bg-bg">
                {visibleProjectGroups.map(group => (
                  <div key={group.orgId} className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-secondary">
                      {group.orgName}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {group.projects.map(project => (
                        <button
                          key={project.id}
                          type="button"
                          onClick={() => toggleProject(project.id)}
                          className={`rounded-md border px-2 py-1 text-xs font-medium transition-all ${
                            selectedProjects.includes(project.id)
                              ? 'border-accent bg-accent/15 text-accent'
                              : 'border-border text-muted hover:text-secondary'
                          }`}
                        >
                          {project.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!scopeAll && visibleProjects.length === 0 && (
              <p className="text-xs text-muted mt-2">{t('apiKeys.createModal.noProjectsInSelectedOrgs')}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-secondary uppercase tracking-wider mb-1.5">
              {t('apiKeys.createModal.expiration')}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {EXPIRY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setExpiry(opt.value)}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-all ${
                    expiry === opt.value
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border text-muted hover:text-secondary'
                  }`}
                >
                  {t(opt.labelKey as any)}
                </button>
              ))}
            </div>
            {expiry === 'custom' && (
              <input
                type="date"
                value={customDate}
                onChange={e => setCustomDate(e.target.value)}
                className="mt-2 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary focus:border-accent focus:outline-none"
              />
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-secondary uppercase tracking-wider mb-1.5">
              {t('apiKeys.createModal.presets')}
            </label>
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                type="button"
                onClick={() => applyPreset('readOnly')}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-secondary hover:border-accent hover:text-accent transition-all"
              >
                <Eye size={12} /> {t('apiKeys.createModal.presetReadOnly')}
              </button>
              <button
                type="button"
                onClick={() => applyPreset('agent')}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-secondary hover:border-accent hover:text-accent transition-all"
              >
                <Bot size={12} /> {t('apiKeys.createModal.presetAgent')}
              </button>
              <button
                type="button"
                onClick={() => applyPreset('cicd')}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-secondary hover:border-accent hover:text-accent transition-all"
              >
                <GitBranch size={12} /> {t('apiKeys.createModal.presetCICD')}
              </button>
              <button
                type="button"
                onClick={() => applyPreset('fullAccess')}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-secondary hover:border-accent hover:text-accent transition-all"
              >
                <Shield size={12} /> {t('apiKeys.createModal.presetFullAccess')}
              </button>
            </div>

            <label className="block text-xs font-semibold text-secondary uppercase tracking-wider mb-2">
              {t('apiKeys.createModal.permissions')}
            </label>
            <PermissionGrid selected={permissions} onChange={setPermissions} t={t} />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-secondary hover:text-primary transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={!name.trim() || effectiveOrgIds.length === 0 || createMutation.isPending}
            onClick={() => createMutation.mutate()}
            className="flex items-center gap-2 rounded-lg bg-accent px-5 py-2 text-sm font-bold text-black hover:bg-accent-hover disabled:opacity-40 transition-colors"
          >
            <Plus size={15} />
            {t('apiKeys.create')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Key Drawer ─────────────────────────────────────────────────────────

interface EditDrawerProps {
  apiKey: ApiKey;
  projects: ProjectOption[];
  organizations: OrgOption[];
  activeOrgId: string | null;
  onClose: () => void;
  onSaved: () => void;
  onRegenerate: () => void;
}

function EditDrawer({ apiKey, projects, organizations, activeOrgId, onClose, onSaved, onRegenerate }: EditDrawerProps) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const initialOrgIds = uniqueStrings(apiKey.org_ids?.length ? apiKey.org_ids : [apiKey.org_id]);
  const [name, setName] = useState(apiKey.name);
  const [permissions, setPermissions] = useState<string[]>(apiKey.permissions);
  const [orgScopeMode, setOrgScopeMode] = useState<OrgScopeMode>(() => (
    isAllCurrentOrganizations(initialOrgIds, organizations) ? 'all' : 'selected'
  ));
  const [selectedOrgIds, setSelectedOrgIds] = useState<string[]>(initialOrgIds);
  const [scopeAll, setScopeAll] = useState(apiKey.project_ids.length === 0);
  const [selectedProjects, setSelectedProjects] = useState<string[]>(apiKey.project_ids);

  const effectiveOrgIds = useMemo(
    () => getEffectiveOrgIds(orgScopeMode, activeOrgId, selectedOrgIds, organizations),
    [orgScopeMode, activeOrgId, selectedOrgIds, organizations],
  );

  const visibleProjects = useMemo(
    () => projects.filter(project => effectiveOrgIds.includes(project.org_id)),
    [projects, effectiveOrgIds],
  );

  const visibleProjectGroups = useMemo(
    () => groupProjectsByOrg(visibleProjects, organizations),
    [visibleProjects, organizations],
  );

  const effectiveOrgNames = useMemo(
    () => getOrgNames(effectiveOrgIds, organizations),
    [effectiveOrgIds, organizations],
  );

  useEffect(() => {
    const visibleIds = new Set(visibleProjects.map(project => project.id));
    setSelectedProjects(prev => prev.filter(id => visibleIds.has(id)));
  }, [visibleProjects]);

  const updateMutation = useMutation({
    mutationFn: () =>
      apiClient.apiKeys.update(apiKey.id, {
        name: name.trim(),
        permissions,
        org_ids: effectiveOrgIds,
        project_ids: scopeAll ? [] : selectedProjects,
      }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  const toggleProject = (id: string) => {
    setSelectedProjects(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id],
    );
  };

  const toggleOrg = (id: string) => {
    setSelectedOrgIds(prev =>
      prev.includes(id) ? prev.filter(orgId => orgId !== id) : [...prev, id],
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-end bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full sm:w-[480px] h-[90vh] sm:h-full sm:max-h-screen rounded-t-2xl sm:rounded-l-2xl sm:rounded-r-none border border-border bg-surface shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Pencil size={15} className="text-accent" />
            <h2 className="text-sm font-semibold text-primary">{t('apiKeys.editDrawer.title')}</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-primary">
            <X size={15} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-secondary uppercase tracking-wider mb-1.5">
              {t('apiKeys.col.name')}
            </label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-secondary uppercase tracking-wider mb-1.5">
              {t('apiKeys.createModal.orgScope')}
            </label>
            <p className="text-xs text-muted mb-2">
              {t('apiKeys.createModal.orgScopeHelp')}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 mb-2">
              <button
                type="button"
                onClick={() => setOrgScopeMode('current')}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                  orgScopeMode === 'current' ? 'border-accent bg-accent/10 text-accent' : 'border-border text-secondary hover:text-primary'
                }`}
              >
                {t('apiKeys.createModal.orgScopeCurrent')}
              </button>
              <button
                type="button"
                onClick={() => setOrgScopeMode('selected')}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                  orgScopeMode === 'selected' ? 'border-accent bg-accent/10 text-accent' : 'border-border text-secondary hover:text-primary'
                }`}
              >
                {t('apiKeys.createModal.orgScopeSelected')}
              </button>
              <button
                type="button"
                onClick={() => setOrgScopeMode('all')}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                  orgScopeMode === 'all' ? 'border-accent bg-accent/10 text-accent' : 'border-border text-secondary hover:text-primary'
                }`}
              >
                {t('apiKeys.createModal.orgScopeAllCurrent')}
              </button>
            </div>
            {orgScopeMode === 'selected' && organizations.length > 0 && (
              <div className="flex flex-wrap gap-1.5 p-3 rounded-lg border border-border bg-bg">
                {organizations.map(org => (
                  <button
                    key={org.id}
                    type="button"
                    onClick={() => toggleOrg(org.id)}
                    className={`rounded-md border px-2 py-1 text-xs font-medium transition-all ${
                      selectedOrgIds.includes(org.id)
                        ? 'border-accent bg-accent/15 text-accent'
                        : 'border-border text-muted hover:text-secondary'
                    }`}
                  >
                    {org.name}
                  </button>
                ))}
              </div>
            )}
            {orgScopeMode === 'all' && (
              <p className="text-xs text-muted mt-2">
                {t('apiKeys.createModal.orgScopeAllCurrentHelp')}
              </p>
            )}
            <div className="mt-3 rounded-lg border border-border bg-bg px-3 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-secondary">
                {t('apiKeys.createModal.orgTargets')}
              </div>
              {effectiveOrgNames.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {effectiveOrgNames.map(name => (
                    <span key={name} className="rounded-md border border-accent/20 bg-accent/10 px-2 py-1 text-xs font-medium text-accent">
                      {name}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted">{t('apiKeys.createModal.orgTargetsEmpty')}</p>
              )}
              {scopeAll && effectiveOrgNames.length > 0 && (
                <p className="mt-2 text-xs text-muted">{t('apiKeys.createModal.scopeAllAppliesHelp')}</p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-secondary uppercase tracking-wider mb-1.5">
              {t('apiKeys.createModal.projectScope')}
            </label>
            <p className="text-xs text-muted mb-2">
              {t('apiKeys.createModal.projectScopeHelp')}
            </p>
            <div className="flex gap-2 mb-2">
              <button
                type="button"
                onClick={() => setScopeAll(true)}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                  scopeAll ? 'border-accent bg-accent/10 text-accent' : 'border-border text-secondary hover:text-primary'
                }`}
              >
                {t('apiKeys.createModal.scopeAll')}
              </button>
              <button
                type="button"
                onClick={() => setScopeAll(false)}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                  !scopeAll ? 'border-accent bg-accent/10 text-accent' : 'border-border text-secondary hover:text-primary'
                }`}
              >
                {t('apiKeys.createModal.scopeSpecific')}
              </button>
            </div>
            {!scopeAll && visibleProjects.length > 0 && (
              <div className="space-y-3 p-3 rounded-lg border border-border bg-bg">
                {visibleProjectGroups.map(group => (
                  <div key={group.orgId} className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-secondary">
                      {group.orgName}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {group.projects.map(project => (
                        <button
                          key={project.id}
                          type="button"
                          onClick={() => toggleProject(project.id)}
                          className={`rounded-md border px-2 py-1 text-xs font-medium transition-all ${
                            selectedProjects.includes(project.id)
                              ? 'border-accent bg-accent/15 text-accent'
                              : 'border-border text-muted hover:text-secondary'
                          }`}
                        >
                          {project.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!scopeAll && visibleProjects.length === 0 && (
              <p className="text-xs text-muted mt-2">{t('apiKeys.createModal.noProjectsInSelectedOrgs')}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-secondary uppercase tracking-wider mb-2">
              {t('apiKeys.createModal.permissions')}
            </label>
            <PermissionGrid selected={permissions} onChange={setPermissions} t={t} />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-border shrink-0">
          <button
            type="button"
            onClick={() => {
              onRegenerate();
              onClose();
            }}
            className="flex items-center gap-2 rounded-lg border border-amber-500/30 px-4 py-2 text-sm text-amber-400 hover:bg-amber-500/10 transition-colors"
          >
            <RefreshCw size={14} />
            {t('apiKeys.regenerateConfirmBtn')}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-secondary hover:text-primary"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              disabled={!name.trim() || effectiveOrgIds.length === 0 || updateMutation.isPending}
              onClick={() => updateMutation.mutate()}
              className="flex items-center gap-2 rounded-lg bg-accent px-5 py-2 text-sm font-bold text-black hover:bg-accent-hover disabled:opacity-40 transition-colors"
            >
              {t('apiKeys.editDrawer.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── New Key Banner (shown once after creation) ──────────────────────────────

function NewKeyBanner({
  secret,
  onDismiss,
  t,
}: {
  secret: string;
  onDismiss: () => void;
  t: (k: string, opts?: any) => string;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="mb-6 space-y-4">
      {/* Warning */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-200">{t('settings.copyWarning')}</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 rounded-lg bg-bg px-3 py-2 text-sm font-mono text-primary border border-border truncate">
                {secret}
              </code>
              <button
                onClick={() => handleCopy(secret, 'new')}
                className="shrink-0 p-2 rounded-lg bg-surface-hover text-secondary hover:text-primary"
              >
                {copied === 'new' ? <CheckCircle2 size={16} className="text-green-400" /> : <Copy size={16} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Agent Quick Start */}
      <div className="rounded-xl border border-accent/20 bg-accent/5 p-5">
        <h3 className="text-sm font-semibold text-accent mb-3 flex items-center gap-1.5">
          <Zap size={14} /> {t('apiKeys.agentQuickStart')}
        </h3>
        <div className="space-y-3 text-xs font-mono">
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-secondary font-sans text-xs">{t('apiKeys.qs.env')}</p>
              <button
                onClick={() => handleCopy(`BAATON_API_KEY=${secret}\nBAATON_BASE_URL=https://api.baaton.dev/api/v1`, 'env')}
                className="p-1 rounded text-muted hover:text-secondary"
              >
                {copied === 'env' ? <CheckCircle2 size={12} className="text-green-400" /> : <Copy size={12} />}
              </button>
            </div>
            <pre className="rounded-lg bg-bg border border-border p-3 text-primary whitespace-pre-wrap break-all">
{`BAATON_API_KEY=${secret}
BAATON_BASE_URL=https://api.baaton.dev/api/v1`}
            </pre>
          </div>
          <div>
            <p className="text-secondary mb-1 font-sans text-xs">{t('apiKeys.qs.getDocs')}</p>
            <pre className="rounded-lg bg-bg border border-border p-3 text-primary whitespace-pre-wrap break-all">
{`curl -s https://api.baaton.dev/api/v1/public/docs`}
            </pre>
          </div>
          <div>
            <p className="text-secondary mb-1 font-sans text-xs">{t('apiKeys.qs.createIssue')}</p>
            <pre className="rounded-lg bg-bg border border-border p-3 text-primary whitespace-pre-wrap break-all">
{`curl -X POST https://api.baaton.dev/api/v1/issues \\
  -H "Authorization: Bearer ${secret}" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"...","title":"Fix bug","priority":"high"}'`}
            </pre>
          </div>
        </div>
        <Link to="/docs" className="inline-flex items-center gap-1 mt-4 text-sm text-accent hover:underline">
          <BookOpen size={14} /> {t('apiKeys.qs.viewDocs')}
        </Link>
      </div>

      <button onClick={onDismiss} className="text-xs text-muted hover:text-secondary">
        {t('settings.dismiss')}
      </button>
    </div>
  );
}

// ─── Regenerate Confirm Modal ────────────────────────────────────────────────

function RegenerateModal({
  target,
  onConfirm,
  onClose,
  t,
}: {
  target: { id: string; name: string };
  onConfirm: () => void;
  onClose: () => void;
  t: (k: string, opts?: any) => string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10">
            <AlertTriangle size={20} className="text-amber-500" />
          </div>
          <div>
            <h3 className="font-semibold text-primary">{t('apiKeys.regenerateTitle')}</h3>
            <p className="text-xs text-muted">{target.name}</p>
          </div>
        </div>
        <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3 mb-4">
          <p className="text-xs text-secondary leading-relaxed">{t('apiKeys.regenerateWarning')}</p>
        </div>
        <ul className="space-y-1.5 mb-6 text-xs text-secondary">
          {(['regeneratePoint1', 'regeneratePoint2'] as const).map(k => (
            <li key={k} className="flex items-start gap-2">
              <span className="text-amber-500 mt-0.5">•</span>
              {t(`apiKeys.${k}` as any)}
            </li>
          ))}
          <li className="flex items-start gap-2">
            <span className="text-emerald-500 mt-0.5">•</span>
            {t('apiKeys.regeneratePoint3')}
          </li>
        </ul>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs font-medium text-secondary hover:text-primary"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={() => { onConfirm(); onClose(); }}
            className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-black hover:bg-amber-400"
          >
            {t('apiKeys.regenerateConfirmBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Key Table Row ────────────────────────────────────────────────────────────

function KeyTableRow({
  apiKey,
  projects,
  organizations,
  onEdit,
  onRegenerate,
  onDelete,
  t,
}: {
  apiKey: ApiKey;
  projects: Array<{ id: string; name: string }>;
  organizations: OrgOption[];
  onEdit: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
  t: (k: string, opts?: any) => string;
}) {
  const [showPrefix, setShowPrefix] = useState(false);

  const orgScopeLabel = useMemo(
    () => getOrgScopeLabel(apiKey, organizations, t),
    [apiKey, organizations, t],
  );

  const scopeLabel = useMemo(() => {
    if (apiKey.project_ids.length === 0) return t('apiKeys.scopeAll');
    const names = apiKey.project_ids
      .map(id => projects.find(p => p.id === id)?.name)
      .filter(Boolean);
    return names.length > 0
      ? names.join(', ')
      : t('apiKeys.scopeProjects', { count: apiKey.project_ids.length });
  }, [apiKey.project_ids, projects, t]);

  // Show first 3 perms + count overflow
  const visiblePerms = apiKey.permissions.slice(0, 3);
  const overflowCount = apiKey.permissions.length - 3;

  const isExpired = apiKey.expires_at && new Date(apiKey.expires_at) < new Date();

  return (
    <tr
      onClick={onEdit}
      className="border-b border-border last:border-0 hover:bg-surface-hover/40 transition-colors group cursor-pointer"
    >
      {/* Name */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5 text-sm font-medium text-primary">
          {apiKey.name}
          <Pencil size={11} className="opacity-0 group-hover:opacity-40 transition-opacity" />
        </div>
      </td>

      {/* Org */}
      <td className="px-4 py-3 hidden sm:table-cell">
        <span className="text-xs text-muted">
          {orgScopeLabel}
        </span>
      </td>

      {/* Scope */}
      <td className="px-4 py-3 hidden sm:table-cell">
        <span className="rounded-md border border-border bg-surface-hover px-2 py-0.5 text-xs text-secondary">
          {scopeLabel}
        </span>
      </td>

      {/* Permissions */}
      <td className="px-4 py-3 hidden md:table-cell">
        <div className="flex items-center gap-1 flex-wrap">
          {apiKey.permissions.length === 0 ? (
            <span className="text-xs text-muted">{t('apiKeys.noPermissions')}</span>
          ) : (
            <>
              {visiblePerms.map(p => (
                <PermBadge key={p} perm={p} t={t} compact />
              ))}
              {overflowCount > 0 && (
                <span className="text-[10px] text-muted">+{overflowCount}</span>
              )}
            </>
          )}
        </div>
      </td>

      {/* Key prefix */}
      <td className="px-4 py-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowPrefix(!showPrefix);
          }}
          className="flex items-center gap-1.5 text-xs font-mono text-secondary hover:text-primary transition-colors"
        >
          {showPrefix ? (
            <><EyeOff size={11} /><span>{apiKey.key_prefix}••••</span></>
          ) : (
            <><Eye size={11} /><span>••••••••••••</span></>
          )}
        </button>
      </td>

      {/* Last used */}
      <td className="px-4 py-3 hidden lg:table-cell">
        <span className="text-xs text-muted">
          {apiKey.last_used_at ? timeAgo(apiKey.last_used_at) : '—'}
        </span>
      </td>

      {/* Expires */}
      <td className="px-4 py-3 hidden lg:table-cell">
        <span className={`text-xs ${isExpired ? 'text-red-400' : 'text-muted'}`}>
          {formatExpiry(apiKey.expires_at)}
        </span>
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="rounded-md p-1.5 text-muted hover:bg-accent/10 hover:text-accent transition-all"
            title="Edit key"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRegenerate();
            }}
            className="rounded-md p-1.5 text-muted hover:bg-amber-500/10 hover:text-amber-400 transition-all"
            title="Regenerate key"
          >
            <RefreshCw size={13} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="rounded-md p-1.5 text-muted hover:bg-red-500/10 hover:text-red-400 transition-all"
            title="Revoke key"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function ApiKeys() {
  const { t } = useTranslation();
  const { organization: activeOrg } = useOrganization();
  const { userMemberships } = useOrganizationList({ userMemberships: { infinite: true } });
  const apiClient = useApi();
  const queryClient = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [newKeySecret, setNewKeySecret] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<ApiKey | null>(null);
  const [regenerateTarget, setRegenerateTarget] = useState<{ id: string; name: string } | null>(null);

  const { data: apiKeys = [], isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => apiClient.apiKeys.list(),
    retry: false,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects-all-orgs'],
    queryFn: () => apiClient.get<ProjectOption[]>('/projects?all=true'),
    retry: false,
    staleTime: 60_000,
  });

  const organizations = useMemo<OrgOption[]>(() => (
    (userMemberships?.data ?? []).map(membership => ({
      id: membership.organization.id,
      name: membership.organization.name || membership.organization.slug || membership.organization.id,
      slug: membership.organization.slug || undefined,
    }))
  ), [userMemberships?.data]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.apiKeys.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys'] }),
  });

  const regenerateMutation = useMutation({
    mutationFn: (id: string) => apiClient.apiKeys.regenerate(id),
    onSuccess: (data) => {
      setNewKeySecret(data.key);
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-primary">{t('apiKeys.title')}</h1>
          <p className="mt-1 text-sm text-secondary">{t('apiKeys.description')}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-bold text-black hover:bg-accent-hover transition-colors"
        >
          <Plus size={16} />
          {t('apiKeys.create')}
        </button>
      </div>

      {/* New Key Banner */}
      {newKeySecret && (
        <NewKeyBanner
          secret={newKeySecret}
          onDismiss={() => setNewKeySecret(null)}
          t={t}
        />
      )}

      {/* Keys Table */}
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">
                  {t('apiKeys.col.name')}
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wider hidden sm:table-cell">
                  {t('apiKeys.col.org')}
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wider hidden sm:table-cell">
                  {t('apiKeys.col.scope')}
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wider hidden md:table-cell">
                  {t('apiKeys.col.permissions')}
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">
                  {t('apiKeys.col.key')}
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wider hidden lg:table-cell">
                  {t('apiKeys.col.lastUsed')}
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wider hidden lg:table-cell">
                  {t('apiKeys.col.expires')}
                </th>
                <th className="px-4 py-3 w-20" />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted">
                    {t('settings.loadingKeys')}
                  </td>
                </tr>
              ) : apiKeys.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-hover">
                        <Key size={22} className="text-muted" />
                      </div>
                      <p className="text-sm text-muted">{t('settings.noKeys')}</p>
                      <button
                        onClick={() => setShowCreate(true)}
                        className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-secondary hover:border-accent hover:text-accent transition-all"
                      >
                        <Plus size={12} /> {t('apiKeys.create')}
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                apiKeys.map(key => (
                  <KeyTableRow
                    key={key.id}
                    apiKey={key}
                    projects={projects}
                    organizations={organizations}
                    t={t}
                    onEdit={() => setEditTarget(key)}
                    onRegenerate={() => setRegenerateTarget({ id: key.id, name: key.name })}
                    onDelete={() => deleteMutation.mutate(key.id)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <CreateModal
          projects={projects}
          organizations={organizations}
          activeOrgId={activeOrg?.id ?? null}
          onClose={() => setShowCreate(false)}
          onCreated={(data) => {
            setNewKeySecret(data.key);
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['api-keys'] });
          }}
        />
      )}

      {/* Edit Drawer */}
      {editTarget && (
        <EditDrawer
          apiKey={editTarget}
          projects={projects}
          organizations={organizations}
          activeOrgId={activeOrg?.id ?? null}
          onClose={() => setEditTarget(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['api-keys'] })}
          onRegenerate={() => setRegenerateTarget({ id: editTarget.id, name: editTarget.name })}
        />
      )}

      {/* Regenerate Confirm */}
      {regenerateTarget && (
        <RegenerateModal
          target={regenerateTarget}
          onConfirm={() => regenerateMutation.mutate(regenerateTarget.id)}
          onClose={() => setRegenerateTarget(null)}
          t={t}
        />
      )}
    </div>
  );
}

export default ApiKeys;
