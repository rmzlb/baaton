import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  BookOpen,
  Rocket,
  LayoutDashboard,
  List,
  Bot,
  PanelRight,
  Sun,
  Globe,
  Keyboard,
  LinkIcon,
  Plug,
  Github,
  ShieldCheck,
  Brain,
  Server,
  ChevronLeft,
  Menu,
  X,
  ArrowUp,
  ExternalLink,
  Archive,
  Bell,
  Key,
  Mail,
  Repeat,
  Target,
  Filter,
  Zap,
  Activity,
  Download,
  Upload,
  CreditCard,
  Star,
  Hash,
  Layers,
  Timer,
  Terminal,
  RefreshCw,
  Calendar,
  Sparkles,
  AlertCircle,
  Database,
  Users,
  Webhook,
} from 'lucide-react';

/* ─── Types ────────────────────────────────── */
interface NavSection {
  id: string;
  labelKey: string;
  icon: React.ReactNode;
  children: { id: string; labelKey: string }[];
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
interface EndpointDef {
  method: HttpMethod;
  path: string;
  desc: string;
}
interface EndpointGroup {
  cat: string;
  endpoints: EndpointDef[];
}

/* ─── All API Endpoints (grouped) ─────────── */
const ALL_ENDPOINT_GROUPS: EndpointGroup[] = [
  {
    cat: 'Projects',
    endpoints: [
      { method: 'GET',    path: '/projects',                          desc: 'List all projects in the org' },
      { method: 'POST',   path: '/projects',                          desc: 'Create a new project' },
      { method: 'GET',    path: '/projects/:id',                      desc: 'Get project details & custom statuses' },
      { method: 'PATCH',  path: '/projects/:id',                      desc: 'Update project settings (name, description, etc.)' },
      { method: 'DELETE', path: '/projects/:id',                      desc: 'Permanently delete a project' },
      { method: 'GET',    path: '/projects/:id/issues',               desc: 'List issues filtered to a project' },
      { method: 'GET',    path: '/projects/:id/tags',                 desc: 'List tags for a project' },
      { method: 'POST',   path: '/projects/:id/tags',                 desc: 'Create a tag in a project' },
      { method: 'GET',    path: '/projects/:id/auto-assign',          desc: 'Get auto-assign rules' },
      { method: 'PATCH',  path: '/projects/:id/auto-assign',         desc: 'Update auto-assign rules' },
      { method: 'GET',    path: '/projects/:id/public-submit',        desc: 'Get public submission settings' },
      { method: 'PATCH',  path: '/projects/:id/public-submit',        desc: 'Update public submission settings (slug, fields)' },
      { method: 'POST',   path: '/projects/:id/refresh-github',       desc: 'Force-sync GitHub repository data' },
      { method: 'GET',    path: '/projects/by-slug/:slug/board',      desc: 'Public board view by project slug (no auth)' },
      { method: 'GET',    path: '/projects/:id/export',               desc: 'Export all project issues as JSON' },
      { method: 'POST',   path: '/projects/:id/import',               desc: 'Import issues from JSON dump' },
    ],
  },
  {
    cat: 'Issues',
    endpoints: [
      { method: 'GET',    path: '/issues',                            desc: 'List all issues across accessible projects' },
      { method: 'POST',   path: '/issues',                            desc: 'Create a new issue' },
      { method: 'GET',    path: '/issues/mine',                       desc: "List issues assigned to the authenticated user" },
      { method: 'PATCH',  path: '/issues/batch',                      desc: 'Batch-update multiple issues (status, priority, assignee)' },
      { method: 'DELETE', path: '/issues/batch',                      desc: 'Batch-delete multiple issues' },
      { method: 'GET',    path: '/issues/:id',                        desc: 'Get issue details with TLDRs & comments' },
      { method: 'PATCH',  path: '/issues/:id',                        desc: 'Update issue fields (title, status, priority, etc.)' },
      { method: 'DELETE', path: '/issues/:id',                        desc: 'Delete an issue permanently' },
      { method: 'PATCH',  path: '/issues/:id/position',               desc: 'Update kanban position (drag-and-drop)' },
      { method: 'GET',    path: '/issues/:id/children',               desc: 'List sub-issues (children)' },
      { method: 'POST',   path: '/issues/:id/triage',                 desc: 'AI triage — suggests priority, tags, assignee' },
    ],
  },
  {
    cat: 'Comments & TLDRs',
    endpoints: [
      { method: 'GET',    path: '/issues/:id/comments',               desc: 'List all comments on an issue' },
      { method: 'POST',   path: '/issues/:id/comments',               desc: 'Add a comment (author auto-filled from API key)' },
      { method: 'DELETE', path: '/issues/:id/comments/:cid',          desc: 'Delete a comment' },
      { method: 'POST',   path: '/issues/:id/tldr',                   desc: 'Post an agent TLDR / work summary' },
    ],
  },
  {
    cat: 'Relations & Sub-issues',
    endpoints: [
      { method: 'GET',    path: '/issues/:id/relations',              desc: 'List relations (blocks, relates_to, duplicates)' },
      { method: 'POST',   path: '/issues/:id/relations',              desc: 'Create a relation between two issues' },
      { method: 'DELETE', path: '/issues/:id/relations/:relation_id', desc: 'Remove a relation' },
    ],
  },
  {
    cat: 'Archive',
    endpoints: [
      { method: 'POST',   path: '/issues/:id/archive',                desc: 'Archive an issue (hidden but recoverable)' },
      { method: 'POST',   path: '/issues/:id/unarchive',              desc: 'Unarchive an issue' },
    ],
  },
  {
    cat: 'Attachments',
    endpoints: [
      { method: 'GET',    path: '/issues/:id/attachments',            desc: 'List attachments on an issue' },
      { method: 'POST',   path: '/issues/:id/attachments',            desc: 'Upload attachment (base64, max 20 MB)' },
      { method: 'DELETE', path: '/issues/:id/attachments/:att_id',    desc: 'Delete an attachment' },
    ],
  },
  {
    cat: 'Search',
    endpoints: [
      { method: 'GET',    path: '/search?q=',                         desc: 'Full-text search within org/project' },
      { method: 'GET',    path: '/search/global?q=',                  desc: 'Cross-org global full-text search' },
    ],
  },
  {
    cat: 'Cycles',
    endpoints: [
      { method: 'GET',    path: '/projects/:id/cycles',               desc: 'List cycles for a project' },
      { method: 'POST',   path: '/projects/:id/cycles',               desc: 'Create a new cycle' },
      { method: 'GET',    path: '/cycles/:id',                        desc: 'Get cycle details' },
      { method: 'PATCH',  path: '/cycles/:id',                        desc: 'Update cycle (name, dates, description)' },
      { method: 'POST',   path: '/cycles/:id/complete',               desc: 'Mark a cycle as complete' },
    ],
  },
  {
    cat: 'Sprints',
    endpoints: [
      { method: 'GET',    path: '/projects/:id/sprints',              desc: 'List sprints for a project' },
      { method: 'POST',   path: '/projects/:id/sprints',              desc: 'Create a new sprint' },
      { method: 'PUT',    path: '/sprints/:id',                       desc: 'Replace sprint data (full update)' },
      { method: 'DELETE', path: '/sprints/:id',                       desc: 'Delete a sprint' },
    ],
  },
  {
    cat: 'Milestones',
    endpoints: [
      { method: 'GET',    path: '/projects/:id/milestones',           desc: 'List milestones for a project' },
      { method: 'POST',   path: '/projects/:id/milestones',           desc: 'Create a milestone' },
      { method: 'GET',    path: '/milestones/:id',                    desc: 'Get milestone details' },
      { method: 'PUT',    path: '/milestones/:id',                    desc: 'Update a milestone' },
      { method: 'DELETE', path: '/milestones/:id',                    desc: 'Delete a milestone' },
    ],
  },
  {
    cat: 'Views (Saved Filters)',
    endpoints: [
      { method: 'GET',    path: '/views',                             desc: 'List all saved views for the org' },
      { method: 'POST',   path: '/views',                             desc: 'Create a saved view (filter preset)' },
      { method: 'PATCH',  path: '/views/:id',                         desc: 'Update a saved view' },
      { method: 'DELETE', path: '/views/:id',                         desc: 'Delete a saved view' },
      { method: 'GET',    path: '/views/:id/issues',                  desc: 'Run the view and return matching issues' },
    ],
  },
  {
    cat: 'Activity Feed',
    endpoints: [
      { method: 'GET',    path: '/activity',                          desc: 'Recent org-wide activity feed' },
      { method: 'GET',    path: '/issues/:id/activity',               desc: 'Activity timeline for a specific issue' },
    ],
  },
  {
    cat: 'Notifications',
    endpoints: [
      { method: 'GET',    path: '/notifications',                     desc: 'List notifications for current user' },
      { method: 'GET',    path: '/notifications/count',               desc: 'Unread notification count' },
      { method: 'PATCH',  path: '/notifications/:id/read',            desc: 'Mark a notification as read' },
      { method: 'POST',   path: '/notifications/read-all',            desc: 'Mark all notifications as read' },
      { method: 'GET',    path: '/notifications/preferences',         desc: 'Get notification preferences' },
      { method: 'PATCH',  path: '/notifications/preferences',         desc: 'Update notification preferences' },
    ],
  },
  {
    cat: 'API Keys',
    endpoints: [
      { method: 'GET',    path: '/api-keys',                          desc: 'List all API keys (secrets hidden)' },
      { method: 'POST',   path: '/api-keys',                          desc: 'Create an API key — secret returned ONCE' },
      { method: 'DELETE', path: '/api-keys/:id',                      desc: 'Revoke an API key' },
    ],
  },
  {
    cat: 'Invites',
    endpoints: [
      { method: 'GET',    path: '/invites',                           desc: 'List pending org invites' },
      { method: 'POST',   path: '/invites',                           desc: 'Create an invite link (email or open)' },
      { method: 'GET',    path: '/invite/:code',                      desc: 'Resolve and redirect an invite code' },
    ],
  },
  {
    cat: 'Webhooks (Baaton)',
    endpoints: [
      { method: 'GET',    path: '/webhooks',                          desc: 'List webhook subscriptions' },
      { method: 'POST',   path: '/webhooks',                          desc: 'Create webhook (secret returned once)' },
      { method: 'GET',    path: '/webhooks/:id',                      desc: 'Get webhook details' },
      { method: 'PATCH',  path: '/webhooks/:id',                      desc: 'Update URL, event_types, or enabled flag' },
      { method: 'DELETE', path: '/webhooks/:id',                      desc: 'Delete a webhook' },
    ],
  },
  {
    cat: 'Billing & Plans',
    endpoints: [
      { method: 'GET',    path: '/billing',                           desc: 'Current plan, org usage, per-user breakdown, limits' },
      { method: 'PATCH',  path: '/admin/orgs/:id/plan',               desc: 'Change org plan (admin only)' },
    ],
  },
  {
    cat: 'Metrics',
    endpoints: [
      { method: 'GET',    path: '/metrics?days=30',                   desc: 'Issue velocity, resolution time, status breakdown' },
    ],
  },
  {
    cat: 'AI',
    endpoints: [
      { method: 'POST',   path: '/ai/chat',                           desc: 'Chat with the AI assistant (streaming)' },
      { method: 'GET',    path: '/ai/key',                            desc: 'Get AI key/model configuration' },
      { method: 'POST',   path: '/ai/pm-full-review',                 desc: 'Full PM review of a project backlog' },
    ],
  },
  {
    cat: 'GitHub Integration',
    endpoints: [
      { method: 'GET',    path: '/github/install',                    desc: 'Redirect to GitHub App install (OAuth)' },
      { method: 'GET',    path: '/github/callback',                   desc: 'GitHub OAuth callback handler' },
      { method: 'GET',    path: '/github/installation',               desc: 'Get current GitHub installation info' },
      { method: 'POST',   path: '/github/disconnect',                 desc: 'Disconnect GitHub App from org' },
      { method: 'GET',    path: '/github/repos',                      desc: 'List available GitHub repositories' },
      { method: 'GET',    path: '/github/mappings',                   desc: 'List repo ↔ project mappings' },
      { method: 'POST',   path: '/github/mappings',                   desc: 'Create a repo ↔ project mapping' },
      { method: 'PATCH',  path: '/github/mappings/:id',               desc: 'Update a mapping' },
      { method: 'DELETE', path: '/github/mappings/:id',               desc: 'Delete a mapping' },
      { method: 'GET',    path: '/issues/:id/github',                 desc: 'Get linked GitHub PRs/issues for a Baaton issue' },
      { method: 'POST',   path: '/webhooks/github',                   desc: 'GitHub webhook receiver (no auth, signed)' },
    ],
  },
  {
    cat: 'Slack Integration',
    endpoints: [
      { method: 'GET',    path: '/integrations/slack',                desc: 'List Slack workspace integrations' },
      { method: 'POST',   path: '/integrations/slack',                desc: 'Connect a Slack workspace' },
      { method: 'DELETE', path: '/integrations/slack/:id',            desc: 'Disconnect a Slack workspace' },
      { method: 'PATCH',  path: '/integrations/slack/:id/channels',   desc: 'Update channel-to-project mappings' },
      { method: 'POST',   path: '/public/slack/command',              desc: 'Slack slash command handler (no auth)' },
    ],
  },
  {
    cat: 'Automations',
    endpoints: [
      { method: 'GET',    path: '/projects/:id/automations',          desc: 'List workflow automation rules' },
      { method: 'POST',   path: '/projects/:id/automations',          desc: 'Create an automation (trigger → action)' },
      { method: 'PATCH',  path: '/automations/:id',                   desc: 'Update automation rule' },
      { method: 'DELETE', path: '/automations/:id',                   desc: 'Delete an automation rule' },
    ],
  },
  {
    cat: 'SLA',
    endpoints: [
      { method: 'GET',    path: '/projects/:id/sla-rules',            desc: 'List SLA rules (per-priority response times)' },
      { method: 'POST',   path: '/projects/:id/sla-rules',            desc: 'Create an SLA rule' },
      { method: 'DELETE', path: '/sla-rules/:id',                     desc: 'Delete an SLA rule' },
      { method: 'GET',    path: '/projects/:id/sla-stats',            desc: 'SLA achievement %, on-time, breached counts' },
    ],
  },
  {
    cat: 'Templates',
    endpoints: [
      { method: 'GET',    path: '/projects/:id/templates',            desc: 'List issue templates' },
      { method: 'POST',   path: '/projects/:id/templates',            desc: 'Create an issue template' },
      { method: 'GET',    path: '/templates/:id',                     desc: 'Get template details' },
      { method: 'PATCH',  path: '/templates/:id',                     desc: 'Update a template' },
      { method: 'DELETE', path: '/templates/:id',                     desc: 'Delete a template' },
    ],
  },
  {
    cat: 'Recurring Issues',
    endpoints: [
      { method: 'GET',    path: '/projects/:id/recurring',            desc: 'List recurring issue configurations' },
      { method: 'POST',   path: '/projects/:id/recurring',            desc: 'Create a recurring issue rule' },
      { method: 'PATCH',  path: '/recurring/:id',                     desc: 'Update recurrence schedule or fields' },
      { method: 'DELETE', path: '/recurring/:id',                     desc: 'Delete a recurring rule' },
      { method: 'POST',   path: '/recurring/:id/trigger',             desc: 'Manually trigger a recurring issue now' },
    ],
  },
  {
    cat: 'Initiatives',
    endpoints: [
      { method: 'GET',    path: '/initiatives',                       desc: 'List strategic initiatives for the org' },
      { method: 'POST',   path: '/initiatives',                       desc: 'Create an initiative' },
      { method: 'GET',    path: '/initiatives/:id',                   desc: 'Get initiative details' },
      { method: 'PATCH',  path: '/initiatives/:id',                   desc: 'Update an initiative' },
      { method: 'DELETE', path: '/initiatives/:id',                   desc: 'Delete an initiative' },
      { method: 'POST',   path: '/initiatives/:id/projects',          desc: 'Add a project to an initiative' },
      { method: 'DELETE', path: '/initiatives/:id/projects/:pid',     desc: 'Remove a project from an initiative' },
    ],
  },
  {
    cat: 'Tags',
    endpoints: [
      { method: 'DELETE', path: '/tags/:id',                          desc: 'Delete a tag' },
    ],
  },
  {
    cat: 'Public Submission',
    endpoints: [
      { method: 'POST',   path: '/public/:slug/submit',               desc: 'Submit an issue via public form (20 MB, no auth)' },
      { method: 'GET',    path: '/public/resolve/:token',             desc: 'Resolve a public token to a project' },
      { method: 'POST',   path: '/public/:slug/email-intake',         desc: 'Create issue via inbound email webhook' },
    ],
  },
  {
    cat: 'Public Docs',
    endpoints: [
      { method: 'GET',    path: '/public/docs',                       desc: 'Full API reference as Markdown (no auth)' },
      { method: 'GET',    path: '/public/skill',                      desc: 'Agent skill file SKILL.md (no auth)' },
    ],
  },
];

/* ─── Navigation Structure ────────────────── */
const NAV: NavSection[] = [
  {
    id: 'agent-onboarding',
    labelKey: 'Agent Onboarding',
    icon: <Bot size={16} />,
    children: [
      { id: 'agent-quickstart', labelKey: 'Quick Start' },
      { id: 'agent-api-keys',   labelKey: 'API Keys' },
      { id: 'agent-webhooks',   labelKey: 'Webhooks' },
      { id: 'agent-metrics',    labelKey: 'Metrics' },
    ],
  },
  {
    id: 'getting-started',
    labelKey: 'docs.nav.gettingStarted',
    icon: <Rocket size={16} />,
    children: [
      { id: 'signup',        labelKey: 'docs.nav.signup' },
      { id: 'first-project', labelKey: 'docs.nav.firstProject' },
      { id: 'create-issues', labelKey: 'docs.nav.createIssues' },
    ],
  },
  {
    id: 'features',
    labelKey: 'docs.nav.features',
    icon: <BookOpen size={16} />,
    children: [
      { id: 'kanban',       labelKey: 'docs.nav.kanban' },
      { id: 'list-view',    labelKey: 'docs.nav.listView' },
      { id: 'ai-assistant', labelKey: 'docs.nav.aiAssistant' },
      { id: 'issue-drawer', labelKey: 'docs.nav.issueDrawer' },
      { id: 'theming',      labelKey: 'docs.nav.theming' },
      { id: 'i18n',         labelKey: 'docs.nav.i18n' },
      { id: 'shortcuts',    labelKey: 'docs.nav.shortcuts' },
      { id: 'deep-links',   labelKey: 'docs.nav.deepLinks' },
    ],
  },
  {
    id: 'integrations',
    labelKey: 'docs.nav.integrations',
    icon: <Plug size={16} />,
    children: [
      { id: 'agent-skill',       labelKey: 'docs.nav.agentSkill' },
      { id: 'openclaw',          labelKey: 'docs.nav.openclaw' },
      { id: 'github-app',        labelKey: 'docs.nav.githubApp' },
      { id: 'slack-integration', labelKey: 'Slack' },
      { id: 'microsoft-sso',     labelKey: 'docs.nav.microsoftSso' },
    ],
  },
  {
    id: 'ai-guide',
    labelKey: 'docs.nav.aiGuide',
    icon: <Brain size={16} />,
    children: [
      { id: 'ai-skills',    labelKey: 'docs.nav.aiSkills' },
      { id: 'ai-prompts',   labelKey: 'docs.nav.aiPrompts' },
      { id: 'ai-modes',     labelKey: 'docs.nav.aiModes' },
      { id: 'ai-first-api', labelKey: 'AI-First Design' },
    ],
  },
  {
    id: 'api-reference',
    labelKey: 'docs.nav.apiReference',
    icon: <Server size={16} />,
    children: [
      { id: 'api-auth',          labelKey: 'docs.nav.apiAuth' },
      { id: 'api-endpoints',     labelKey: 'docs.nav.apiEndpoints' },
      { id: 'api-projects',      labelKey: 'Projects' },
      { id: 'api-issues',        labelKey: 'Issues' },
      { id: 'api-comments',      labelKey: 'Comments & TLDRs' },
      { id: 'api-relations',     labelKey: 'Relations' },
      { id: 'api-search',        labelKey: 'Search' },
      { id: 'api-cycles',        labelKey: 'Cycles' },
      { id: 'api-sprints',       labelKey: 'Sprints' },
      { id: 'api-milestones',    labelKey: 'Milestones' },
      { id: 'api-views',         labelKey: 'Views' },
      { id: 'api-activity',      labelKey: 'Activity Feed' },
      { id: 'api-attachments',   labelKey: 'Attachments' },
      { id: 'api-archive',       labelKey: 'Archive' },
      { id: 'api-notifications', labelKey: 'Notifications' },
      { id: 'api-keys-section',  labelKey: 'API Keys' },
      { id: 'api-webhooks',      labelKey: 'Webhooks' },
      { id: 'api-billing',       labelKey: 'Billing & Plans' },
      { id: 'api-github',        labelKey: 'GitHub API' },
      { id: 'api-slack-api',     labelKey: 'Slack API' },
      { id: 'api-ai',            labelKey: 'AI Endpoints' },
      { id: 'api-invites',       labelKey: 'Invites' },
      { id: 'api-automations',   labelKey: 'Automations' },
      { id: 'api-sla',           labelKey: 'SLA' },
      { id: 'api-templates',     labelKey: 'Templates' },
      { id: 'api-recurring',     labelKey: 'Recurring Issues' },
      { id: 'api-initiatives',   labelKey: 'Initiatives' },
      { id: 'api-import-export', labelKey: 'Import / Export' },
      { id: 'api-public',        labelKey: 'Public & Email' },
      { id: 'api-admin',         labelKey: 'Admin' },
    ],
  },
  {
    id: 'philosophy',
    labelKey: 'Philosophy',
    icon: <BookOpen size={16} />,
    children: [],
  },
  {
    id: 'contributing',
    labelKey: 'Contributing',
    icon: <Github size={16} />,
    children: [],
  },
];

/* ─── Code Block Component ────────────────── */
function CodeBlock({ children, language }: { children: string; language?: string }) {
  return (
    <pre
      className="overflow-x-auto rounded-lg border border-border bg-surface p-4 text-sm leading-relaxed font-mono text-secondary"
      role="region"
      aria-label={language ? `${language} code` : 'Code block'}
    >
      <code>{children}</code>
    </pre>
  );
}

/* ─── Shortcut Key Component ──────────────── */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded border border-border bg-surface text-xs font-mono text-secondary">
      {children}
    </kbd>
  );
}

/* ─── HTTP Method Badge ───────────────────── */
function Method({ type }: { type: HttpMethod }) {
  const colors: Record<HttpMethod, string> = {
    GET:    'bg-emerald-900/30 text-emerald-400',
    POST:   'bg-blue-900/30 text-blue-400',
    PATCH:  'bg-amber-900/30 text-amber-400',
    PUT:    'bg-violet-900/30 text-violet-400',
    DELETE: 'bg-red-900/30 text-red-400',
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-mono whitespace-nowrap ${colors[type]}`}>
      {type}
    </span>
  );
}

/* ─── Table Category Header Row ──────────── */
function CatRow({ label }: { label: string }) {
  return (
    <tr>
      <td
        colSpan={3}
        className="bg-surface/70 px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-accent/80 border-b border-t border-border"
      >
        {label}
      </td>
    </tr>
  );
}

/* ─── Docs Page ───────────────────────────── */
export function Docs() {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState('getting-started');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);

  const allIds = useMemo(
    () => NAV.flatMap((s) => [s.id, ...s.children.map((c) => c.id)]),
    [],
  );

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0.1 },
    );
    for (const id of allIds) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [allIds]);

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setMobileNavOpen(false);
    }
  }, []);

  const isActive = (id: string) => activeSection === id;

  return (
    <div className="min-h-screen bg-bg text-primary selection:bg-amber-500/20">
      {/* ── Skip Link ──────────────────────── */}
      <a
        href="#docs-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-bg"
      >
        {t('docs.skipToContent')}
      </a>

      {/* ── Top Bar ────────────────────────── */}
      <header className="fixed top-0 z-40 w-full border-b border-border/50 bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="lg:hidden rounded-lg p-2 text-secondary hover:bg-surface-hover hover:text-primary transition-colors"
              onClick={() => setMobileNavOpen(!mobileNavOpen)}
              aria-label={mobileNavOpen ? t('docs.closeNav') : t('docs.openNav')}
              aria-expanded={mobileNavOpen}
            >
              {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <Link
              to="/"
              className="flex items-center gap-2 text-primary font-semibold hover:text-accent transition-colors"
            >
              <ChevronLeft size={16} />
              <span className="text-sm">{t('docs.backHome')}</span>
            </Link>
          </div>
          <h1 className="text-sm font-medium text-secondary">{t('docs.title')}</h1>
          <Link
            to="/sign-up"
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-bg hover:bg-accent-hover transition-colors"
          >
            {t('docs.getStartedBtn')}
          </Link>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl pt-14">
        {/* ── Sidebar ──────────────────────── */}
        <nav
          className={`
            fixed inset-y-0 left-0 z-30 w-64 overflow-y-auto border-r border-border bg-bg pt-14 pb-8 px-3
            transition-transform duration-200
            lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:translate-x-0
            ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}
          `}
          role="navigation"
          aria-label={t('docs.sidebarLabel')}
        >
          <div className="mt-4 space-y-1">
            {NAV.map((section) => (
              <div key={section.id} className="mb-3">
                <button
                  type="button"
                  onClick={() => scrollTo(section.id)}
                  className={`
                    flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors
                    ${isActive(section.id) ? 'bg-surface text-accent' : 'text-primary hover:bg-surface-hover'}
                  `}
                >
                  {section.icon}
                  {t(section.labelKey)}
                </button>
                <div className="ml-5 mt-0.5 space-y-0.5 border-l border-border pl-3">
                  {section.children.map((child) => (
                    <button
                      key={child.id}
                      type="button"
                      onClick={() => scrollTo(child.id)}
                      className={`
                        block w-full rounded-md px-2 py-1 text-left text-xs transition-colors
                        ${isActive(child.id) ? 'text-accent font-medium' : 'text-secondary hover:text-primary'}
                      `}
                    >
                      {t(child.labelKey)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </nav>

        {/* Mobile overlay */}
        {mobileNavOpen && (
          <div
            className="fixed inset-0 z-20 bg-bg/60 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* ── Content ──────────────────────── */}
        <main
          id="docs-content"
          className="flex-1 min-w-0 px-4 sm:px-8 lg:px-12 py-8 lg:py-12"
          role="main"
        >
          <div className="max-w-3xl">

            {/* ═══════════════════════════════════════════════
                AGENT ONBOARDING
            ═══════════════════════════════════════════════ */}
            <section id="agent-onboarding" className="scroll-mt-20 mb-16">
              <h2 className="flex items-center gap-2 text-2xl font-bold mb-2">
                <Bot size={24} className="text-accent" />
                Agent Onboarding
              </h2>
              <p className="text-secondary mb-8">
                Get your AI agent connected to Baaton in under 5 minutes. Create issues, track status, and receive webhooks — all via API.
              </p>

              <article id="agent-quickstart" className="scroll-mt-20 mb-10">
                <h3 className="text-lg font-semibold mb-3">Quick Start</h3>
                <ol className="list-decimal list-inside space-y-2 text-secondary text-sm mb-4">
                  <li>Sign up at <a href="https://baaton.dev" className="text-accent hover:underline">baaton.dev</a> and create an organization</li>
                  <li>Go to <strong>Settings → API Keys</strong> and create a key (prefix: <code className="text-primary bg-surface px-1 rounded">baa_</code>)</li>
                  <li>Create a project (you'll need the <code className="text-primary bg-surface px-1 rounded">project_id</code>)</li>
                  <li>Start creating issues via the API</li>
                </ol>
                <CodeBlock language="bash">{`# Create your first issue
curl -X POST https://api.baaton.dev/api/v1/issues \\
  -H "Authorization: Bearer baa_your_api_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "project_id": "your-project-uuid",
    "title": "Fix login timeout bug",
    "status": "todo",
    "priority": "high"
  }'`}</CodeBlock>
              </article>

              <article id="agent-api-keys" className="scroll-mt-20 mb-10">
                <h3 className="text-lg font-semibold mb-3">API Keys</h3>
                <p className="text-secondary text-sm mb-3">
                  API keys are scoped to your organization. Optionally restrict them to specific projects via <code className="text-primary bg-surface px-1 rounded">project_ids</code>.
                </p>
                <ul className="list-disc list-inside space-y-1 text-secondary text-sm mb-4">
                  <li>Prefix: <code className="text-primary bg-surface px-1 rounded">baa_</code></li>
                  <li>Pass via <code className="text-primary bg-surface px-1 rounded">Authorization: Bearer baa_xxx</code></li>
                  <li>Auto-fills <code className="text-primary bg-surface px-1 rounded">created_by_name</code> from the key name</li>
                  <li>Comments: <code className="text-primary bg-surface px-1 rounded">author_id</code> / <code className="text-primary bg-surface px-1 rounded">author_name</code> auto-populated</li>
                </ul>
                <CodeBlock language="bash">{`# List your API keys
curl https://api.baaton.dev/api/v1/api-keys \\
  -H "Authorization: Bearer baa_your_key"

# Create a new API key
curl -X POST https://api.baaton.dev/api/v1/api-keys \\
  -H "Authorization: Bearer baa_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "my-agent-v2",
    "project_ids": ["uuid-1", "uuid-2"]
  }'
# ⚠️  The "secret" field is ONLY returned in this response. Store it immediately.

# Revoke a key
curl -X DELETE https://api.baaton.dev/api/v1/api-keys/:id \\
  -H "Authorization: Bearer baa_your_key"`}</CodeBlock>
              </article>

              <article id="agent-webhooks" className="scroll-mt-20 mb-10">
                <h3 className="text-lg font-semibold mb-3">Webhooks</h3>
                <p className="text-secondary text-sm mb-3">
                  Register endpoints to receive real-time event notifications. No polling needed.
                </p>
                <CodeBlock language="bash">{`# Create a webhook
curl -X POST https://api.baaton.dev/api/v1/webhooks \\
  -H "Authorization: Bearer baa_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://your-server.com/webhooks/baaton",
    "event_types": ["issue.created", "status.changed"]
  }'`}</CodeBlock>
                <h4 className="text-sm font-semibold mt-4 mb-2">Available Events</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                    <thead className="bg-surface">
                      <tr>
                        <th className="text-left px-3 py-2 border-b border-border font-medium text-primary">Event</th>
                        <th className="text-left px-3 py-2 border-b border-border font-medium text-primary">Description</th>
                      </tr>
                    </thead>
                    <tbody className="text-secondary">
                      <tr><td className="px-3 py-2 border-b border-border font-mono text-xs">issue.created</td><td className="px-3 py-2 border-b border-border">New issue created</td></tr>
                      <tr><td className="px-3 py-2 border-b border-border font-mono text-xs">issue.updated</td><td className="px-3 py-2 border-b border-border">Issue fields updated</td></tr>
                      <tr><td className="px-3 py-2 border-b border-border font-mono text-xs">issue.deleted</td><td className="px-3 py-2 border-b border-border">Issue permanently deleted</td></tr>
                      <tr><td className="px-3 py-2 border-b border-border font-mono text-xs">status.changed</td><td className="px-3 py-2 border-b border-border">Issue status transition</td></tr>
                      <tr><td className="px-3 py-2 border-b border-border font-mono text-xs">comment.created</td><td className="px-3 py-2 border-b border-border">Comment added</td></tr>
                      <tr><td className="px-3 py-2 font-mono text-xs">comment.deleted</td><td className="px-3 py-2">Comment removed</td></tr>
                    </tbody>
                  </table>
                </div>
                <h4 className="text-sm font-semibold mt-4 mb-2">Verifying Signatures</h4>
                <p className="text-secondary text-sm mb-2">
                  Each delivery includes an <code className="text-primary bg-surface px-1 rounded">X-Baaton-Signature</code> header with an HMAC-SHA256 signature.
                </p>
                <CodeBlock language="python">{`import hmac, hashlib

def verify(body: bytes, signature: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(
        secret.encode(), body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)`}</CodeBlock>
              </article>

              <article id="agent-metrics" className="scroll-mt-20 mb-10">
                <h3 className="text-lg font-semibold mb-3">Metrics</h3>
                <p className="text-secondary text-sm mb-3">
                  Track issue velocity and team throughput via API.
                </p>
                <CodeBlock language="bash">{`# Get metrics for the last 30 days
curl https://api.baaton.dev/api/v1/metrics?days=30 \\
  -H "Authorization: Bearer baa_your_key"

# Response:
# {
#   "issues_created": [{"date": "2026-03-01", "count": 5}, ...],
#   "issues_closed": [{"date": "2026-03-01", "count": 3}, ...],
#   "avg_resolution_hours": 12.5,
#   "active_issues": 42,
#   "issues_by_status": {"todo": 15, "in_progress": 12, ...},
#   "issues_by_priority": {"high": 8, "medium": 20, ...}
# }`}</CodeBlock>
              </article>
            </section>

            {/* ═══════════════════════════════════════════════
                GETTING STARTED
            ═══════════════════════════════════════════════ */}
            <section id="getting-started" className="scroll-mt-20 mb-16">
              <h2 className="flex items-center gap-2 text-2xl font-bold mb-2">
                <Rocket size={24} className="text-accent" />
                {t('docs.gettingStarted.title')}
              </h2>
              <p className="text-secondary mb-8">{t('docs.gettingStarted.subtitle')}</p>

              <article id="signup" className="scroll-mt-20 mb-10">
                <h3 className="text-lg font-semibold mb-3">{t('docs.gettingStarted.signup.title')}</h3>
                <p className="text-secondary mb-3">{t('docs.gettingStarted.signup.desc')}</p>
                <ol className="list-decimal list-inside space-y-2 text-secondary text-sm">
                  <li>{t('docs.gettingStarted.signup.step1')}</li>
                  <li>{t('docs.gettingStarted.signup.step2')}</li>
                  <li>{t('docs.gettingStarted.signup.step3')}</li>
                </ol>
              </article>

              <article id="first-project" className="scroll-mt-20 mb-10">
                <h3 className="text-lg font-semibold mb-3">{t('docs.gettingStarted.firstProject.title')}</h3>
                <p className="text-secondary mb-3">{t('docs.gettingStarted.firstProject.desc')}</p>
                <ol className="list-decimal list-inside space-y-2 text-secondary text-sm">
                  <li>{t('docs.gettingStarted.firstProject.step1')}</li>
                  <li>{t('docs.gettingStarted.firstProject.step2')}</li>
                  <li>{t('docs.gettingStarted.firstProject.step3')}</li>
                  <li>{t('docs.gettingStarted.firstProject.step4')}</li>
                </ol>
              </article>

              <article id="create-issues" className="scroll-mt-20 mb-10">
                <h3 className="text-lg font-semibold mb-3">{t('docs.gettingStarted.createIssues.title')}</h3>
                <p className="text-secondary mb-3">{t('docs.gettingStarted.createIssues.desc')}</p>
                <ul className="list-disc list-inside space-y-2 text-secondary text-sm">
                  <li>{t('docs.gettingStarted.createIssues.way1')}</li>
                  <li>{t('docs.gettingStarted.createIssues.way2')}</li>
                  <li>{t('docs.gettingStarted.createIssues.way3')}</li>
                </ul>
              </article>
            </section>

            <hr className="border-border mb-16" />

            {/* ═══════════════════════════════════════════════
                FEATURES
            ═══════════════════════════════════════════════ */}
            <section id="features" className="scroll-mt-20 mb-16">
              <h2 className="flex items-center gap-2 text-2xl font-bold mb-2">
                <BookOpen size={24} className="text-accent" />
                {t('docs.features.title')}
              </h2>
              <p className="text-secondary mb-8">{t('docs.features.subtitle')}</p>

              <article id="kanban" className="scroll-mt-20 mb-10">
                <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
                  <LayoutDashboard size={18} className="text-accent" />
                  {t('docs.features.kanban.title')}
                </h3>
                <p className="text-secondary mb-3">{t('docs.features.kanban.desc')}</p>
                <ul className="list-disc list-inside space-y-1 text-secondary text-sm">
                  <li>{t('docs.features.kanban.dnd')}</li>
                  <li>{t('docs.features.kanban.density')}</li>
                  <li>{t('docs.features.kanban.filters')}</li>
                  <li>{t('docs.features.kanban.sorting')}</li>
                </ul>
              </article>

              <article id="list-view" className="scroll-mt-20 mb-10">
                <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
                  <List size={18} className="text-accent" />
                  {t('docs.features.listView.title')}
                </h3>
                <p className="text-secondary mb-3">{t('docs.features.listView.desc')}</p>
                <ul className="list-disc list-inside space-y-1 text-secondary text-sm">
                  <li>{t('docs.features.listView.sortable')}</li>
                  <li>{t('docs.features.listView.groupable')}</li>
                  <li>{t('docs.features.listView.collapsible')}</li>
                  <li>{t('docs.features.listView.inline')}</li>
                </ul>
              </article>

              <article id="ai-assistant" className="scroll-mt-20 mb-10">
                <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
                  <Bot size={18} className="text-accent" />
                  {t('docs.features.ai.title')}
                </h3>
                <p className="text-secondary mb-3">{t('docs.features.ai.desc')}</p>
                <div className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary space-y-2">
                  <p className="font-medium text-primary">{t('docs.features.ai.highlights')}</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>{t('docs.features.ai.skills')}</li>
                    <li>{t('docs.features.ai.gemini')}</li>
                    <li>{t('docs.features.ai.functionCalling')}</li>
                    <li>{t('docs.features.ai.realtime')}</li>
                  </ul>
                </div>
              </article>

              <article id="issue-drawer" className="scroll-mt-20 mb-10">
                <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
                  <PanelRight size={18} className="text-accent" />
                  {t('docs.features.drawer.title')}
                </h3>
                <p className="text-secondary mb-3">{t('docs.features.drawer.desc')}</p>
                <ul className="list-disc list-inside space-y-1 text-secondary text-sm">
                  <li>{t('docs.features.drawer.twoCol')}</li>
                  <li>{t('docs.features.drawer.comments')}</li>
                  <li>{t('docs.features.drawer.attachments')}</li>
                  <li>{t('docs.features.drawer.annotations')}</li>
                  <li>{t('docs.features.drawer.markdown')}</li>
                </ul>
              </article>

              <article id="theming" className="scroll-mt-20 mb-10">
                <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
                  <Sun size={18} className="text-accent" />
                  {t('docs.features.theming.title')}
                </h3>
                <p className="text-secondary">{t('docs.features.theming.desc')}</p>
              </article>

              <article id="i18n" className="scroll-mt-20 mb-10">
                <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
                  <Globe size={18} className="text-accent" />
                  {t('docs.features.i18n.title')}
                </h3>
                <p className="text-secondary">{t('docs.features.i18n.desc')}</p>
              </article>

              <article id="shortcuts" className="scroll-mt-20 mb-10">
                <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
                  <Keyboard size={18} className="text-accent" />
                  {t('docs.features.shortcuts.title')}
                </h3>
                <p className="text-secondary mb-4">{t('docs.features.shortcuts.desc')}</p>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm" role="table">
                    <thead>
                      <tr className="border-b border-border bg-surface">
                        <th className="px-4 py-2 text-left font-medium text-primary">{t('docs.features.shortcuts.key')}</th>
                        <th className="px-4 py-2 text-left font-medium text-primary">{t('docs.features.shortcuts.action')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      <tr><td className="px-4 py-2"><Kbd>J</Kbd> / <Kbd>K</Kbd></td><td className="px-4 py-2 text-secondary">{t('docs.features.shortcuts.jk')}</td></tr>
                      <tr><td className="px-4 py-2"><Kbd>E</Kbd></td><td className="px-4 py-2 text-secondary">{t('docs.features.shortcuts.e')}</td></tr>
                      <tr><td className="px-4 py-2"><Kbd>N</Kbd></td><td className="px-4 py-2 text-secondary">{t('docs.features.shortcuts.n')}</td></tr>
                      <tr><td className="px-4 py-2"><Kbd>?</Kbd></td><td className="px-4 py-2 text-secondary">{t('docs.features.shortcuts.question')}</td></tr>
                      <tr><td className="px-4 py-2"><Kbd>⌘</Kbd> + <Kbd>K</Kbd></td><td className="px-4 py-2 text-secondary">{t('docs.features.shortcuts.cmdk')}</td></tr>
                      <tr><td className="px-4 py-2"><Kbd>G</Kbd> + <Kbd>I</Kbd></td><td className="px-4 py-2 text-secondary">Go to Initiatives</td></tr>
                      <tr><td className="px-4 py-2"><Kbd>G</Kbd> + <Kbd>A</Kbd></td><td className="px-4 py-2 text-secondary">Go to Automations</td></tr>
                    </tbody>
                  </table>
                </div>
              </article>

              <article id="deep-links" className="scroll-mt-20 mb-10">
                <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
                  <LinkIcon size={18} className="text-accent" />
                  {t('docs.features.deepLinks.title')}
                </h3>
                <p className="text-secondary mb-3">{t('docs.features.deepLinks.desc')}</p>
                <CodeBlock language="url">{'https://app.baaton.dev/projects/my-project?issue=HLM-18'}</CodeBlock>
              </article>
            </section>

            <hr className="border-border mb-16" />

            {/* ═══════════════════════════════════════════════
                INTEGRATIONS
            ═══════════════════════════════════════════════ */}
            <section id="integrations" className="scroll-mt-20 mb-16">
              <h2 className="flex items-center gap-2 text-2xl font-bold mb-2">
                <Plug size={24} className="text-accent" />
                {t('docs.integrations.title')}
              </h2>
              <p className="text-secondary mb-8">{t('docs.integrations.subtitle')}</p>

              <article id="agent-skill" className="scroll-mt-20 mb-10">
                <h3 className="text-lg font-semibold mb-3">{t('docs.integrations.skill.title')}</h3>
                <p className="text-secondary mb-4">{t('docs.integrations.skill.desc')}</p>

                <h4 className="text-sm font-semibold mb-2">{t('docs.integrations.skill.installTitle')}</h4>
                <div className="space-y-2 mb-4">
                  <div className="rounded-lg bg-bg border border-border p-3">
                    <p className="text-xs text-muted mb-1">Claude Code:</p>
                    <code className="text-sm font-mono text-primary">/plugin marketplace add rmzlb/baaton-skills</code>
                  </div>
                  <div className="rounded-lg bg-bg border border-border p-3">
                    <p className="text-xs text-muted mb-1">OpenClaw:</p>
                    <code className="text-sm font-mono text-primary">openclaw skills install rmzlb/baaton-skills/baaton</code>
                  </div>
                  <div className="rounded-lg bg-bg border border-border p-3">
                    <p className="text-xs text-muted mb-1">Git clone:</p>
                    <code className="text-sm font-mono text-primary break-all">git clone https://github.com/rmzlb/baaton-skills ~/.claude/skills/baaton-pm</code>
                  </div>
                  <div className="rounded-lg bg-bg border border-border p-3">
                    <p className="text-xs text-muted mb-1">{t('docs.integrations.skill.curlInstall')}:</p>
                    <code className="text-sm font-mono text-primary break-all">curl -s https://api.baaton.dev/api/v1/public/skill {'>'} ~/.claude/skills/baaton-pm/SKILL.md</code>
                  </div>
                </div>
                <p className="text-xs text-muted mb-4">
                  <a href="https://github.com/rmzlb/baaton-skills" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                    github.com/rmzlb/baaton-skills
                  </a> — {t('docs.integrations.skill.repoDesc')}
                </p>

                <h4 className="text-sm font-semibold mb-2">{t('docs.integrations.skill.configTitle')}</h4>
                <div className="rounded-lg bg-bg border border-border p-3 mb-4">
                  <pre className="text-xs font-mono text-primary whitespace-pre-wrap">{`export BAATON_API_KEY=baa_your_key_here\nexport BAATON_BASE_URL=https://api.baaton.dev/api/v1`}</pre>
                </div>

                <h4 className="text-sm font-semibold mb-2">{t('docs.integrations.skill.featuresTitle')}</h4>
                <ul className="list-disc list-inside space-y-1 text-secondary text-sm mb-4">
                  <li>{t('docs.integrations.skill.feat1')}</li>
                  <li>{t('docs.integrations.skill.feat2')}</li>
                  <li>{t('docs.integrations.skill.feat3')}</li>
                  <li>{t('docs.integrations.skill.feat4')}</li>
                  <li>{t('docs.integrations.skill.feat5')}</li>
                  <li>{t('docs.integrations.skill.feat6')}</li>
                </ul>
              </article>

              <article id="openclaw" className="scroll-mt-20 mb-10">
                <h3 className="text-lg font-semibold mb-3">{t('docs.integrations.openclaw.title')}</h3>
                <p className="text-secondary mb-3">{t('docs.integrations.openclaw.desc')}</p>
                <ol className="list-decimal list-inside space-y-2 text-secondary text-sm">
                  <li>{t('docs.integrations.openclaw.step1')}</li>
                  <li>{t('docs.integrations.openclaw.step2')}</li>
                  <li>{t('docs.integrations.openclaw.step3')}</li>
                  <li>{t('docs.integrations.openclaw.step4')}</li>
                </ol>
              </article>

              <article id="github-app" className="scroll-mt-20 mb-10">
                <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
                  <Github size={18} />
                  {t('docs.integrations.github.title')}
                </h3>
                <p className="text-secondary mb-3">{t('docs.integrations.github.desc')}</p>
                <ul className="list-disc list-inside space-y-1 text-secondary text-sm">
                  <li>{t('docs.integrations.github.feat1')}</li>
                  <li>{t('docs.integrations.github.feat2')}</li>
                  <li>{t('docs.integrations.github.feat3')}</li>
                  <li>{t('docs.integrations.github.feat4')}</li>
                </ul>
              </article>

              <article id="slack-integration" className="scroll-mt-20 mb-10">
                <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
                  <Hash size={18} className="text-accent" />
                  Slack Integration
                </h3>
                <p className="text-secondary mb-3">
                  Connect Baaton to your Slack workspace to receive issue notifications in channels and create/update issues with slash commands.
                </p>
                <h4 className="text-sm font-semibold mb-2">Setup</h4>
                <ol className="list-decimal list-inside space-y-2 text-secondary text-sm mb-4">
                  <li>Go to <strong>Settings → Integrations → Slack</strong></li>
                  <li>Click <strong>Connect Slack Workspace</strong> and authorize the app</li>
                  <li>Map Slack channels to Baaton projects</li>
                  <li>Install the Baaton Slack app and use <code className="text-primary bg-surface px-1 rounded">/baaton</code> commands</li>
                </ol>
                <h4 className="text-sm font-semibold mb-2">Slash Commands</h4>
                <div className="overflow-x-auto rounded-lg border border-border mb-4">
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-border text-secondary">
                      <tr><td className="px-3 py-2 font-mono text-xs text-primary">/baaton create &lt;title&gt;</td><td className="px-3 py-2">Create a new issue</td></tr>
                      <tr><td className="px-3 py-2 font-mono text-xs text-primary">/baaton status &lt;id&gt;</td><td className="px-3 py-2">Get issue status</td></tr>
                      <tr><td className="px-3 py-2 font-mono text-xs text-primary">/baaton list</td><td className="px-3 py-2">List open issues for the mapped project</td></tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted">
                  The Slack command endpoint <code className="text-accent bg-surface px-1 rounded">/public/slack/command</code> is public (authenticated via Slack signing secret).
                </p>
              </article>

              <article id="microsoft-sso" className="scroll-mt-20 mb-10">
                <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
                  <ShieldCheck size={18} className="text-accent" />
                  {t('docs.integrations.microsoft.title')}
                </h3>
                <div className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1 text-xs font-medium text-secondary">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  {t('docs.integrations.microsoft.comingSoon')}
                </div>
                <p className="text-secondary mt-3">{t('docs.integrations.microsoft.desc')}</p>
              </article>
            </section>

            <hr className="border-border mb-16" />

            {/* ═══════════════════════════════════════════════
                AI ASSISTANT GUIDE
            ═══════════════════════════════════════════════ */}
            <section id="ai-guide" className="scroll-mt-20 mb-16">
              <h2 className="flex items-center gap-2 text-2xl font-bold mb-2">
                <Brain size={24} className="text-accent" />
                {t('docs.aiGuide.title')}
              </h2>
              <p className="text-secondary mb-8">{t('docs.aiGuide.subtitle')}</p>

              <article id="ai-skills" className="scroll-mt-20 mb-10">
                <h3 className="text-lg font-semibold mb-4">{t('docs.aiGuide.skills.title')}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Existing skills — translated */}
                  {([
                    { icon: '🔍', key: 'search' },
                    { icon: '➕', key: 'create' },
                    { icon: '✏️', key: 'update' },
                    { icon: '📦', key: 'bulkUpdate' },
                    { icon: '💬', key: 'comment' },
                    { icon: '📊', key: 'metrics' },
                    { icon: '🏃', key: 'sprint' },
                    { icon: '📋', key: 'recap' },
                    { icon: '🎯', key: 'priorities' },
                    { icon: '📄', key: 'prd' },
                  ] as const).map(({ icon, key }) => (
                    <div
                      key={key}
                      className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3"
                    >
                      <span className="text-lg">{icon}</span>
                      <div>
                        <p className="text-sm font-medium text-primary">
                          {t(`docs.aiGuide.skills.${key}.name`)}
                        </p>
                        <p className="text-xs text-secondary">
                          {t(`docs.aiGuide.skills.${key}.desc`)}
                        </p>
                      </div>
                    </div>
                  ))}
                  {/* New skills — inline strings */}
                  {([
                    { icon: '🧠', name: 'AI Triage',       desc: 'Auto-suggest priority, tags & assignee for any issue' },
                    { icon: '🔗', name: 'Link Issues',      desc: 'Create blocks / relates_to / duplicates relations' },
                    { icon: '🔄', name: 'Cycles',           desc: 'Manage time-boxed work cycles (start, complete)' },
                    { icon: '🏁', name: 'Milestones',       desc: 'Track milestone progress, deadlines & completion %' },
                    { icon: '🔔', name: 'Webhooks',         desc: 'Register, list and verify webhook subscriptions' },
                    { icon: '🗂️', name: 'Archive',          desc: 'Archive stale or completed issues, unarchive if needed' },
                    { icon: '⚡', name: 'Automations',      desc: 'Create trigger → action workflow rules' },
                    { icon: '⏱️', name: 'SLA Monitor',      desc: 'Check SLA compliance rates and breach risk' },
                    { icon: '⭐', name: 'Initiatives',      desc: 'Manage strategic goals and link projects to them' },
                    { icon: '🔁', name: 'Recurring Issues', desc: 'Schedule recurring issues on daily/weekly/custom cadences' },
                  ] as const).map(({ icon, name, desc }) => (
                    <div
                      key={name}
                      className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3"
                    >
                      <span className="text-lg">{icon}</span>
                      <div>
                        <p className="text-sm font-medium text-primary">{name}</p>
                        <p className="text-xs text-secondary">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </article>

              <article id="ai-prompts" className="scroll-mt-20 mb-10">
                <h3 className="text-lg font-semibold mb-4">{t('docs.aiGuide.prompts.title')}</h3>
                <div className="space-y-3">
                  {(['prompt1', 'prompt2', 'prompt3', 'prompt4', 'prompt5'] as const).map((key) => (
                    <div key={key} className="rounded-lg border border-border bg-surface px-4 py-3">
                      <p className="text-sm font-mono text-accent">
                        "{t(`docs.aiGuide.prompts.${key}`)}"
                      </p>
                    </div>
                  ))}
                </div>
              </article>

              <article id="ai-modes" className="scroll-mt-20 mb-10">
                <h3 className="text-lg font-semibold mb-3">{t('docs.aiGuide.modes.title')}</h3>
                <p className="text-secondary mb-4">{t('docs.aiGuide.modes.desc')}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="rounded-lg border border-border bg-surface p-4">
                    <p className="font-medium text-primary mb-1">🤖 {t('docs.aiGuide.modes.gemini.title')}</p>
                    <p className="text-xs text-secondary">{t('docs.aiGuide.modes.gemini.desc')}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-surface p-4">
                    <p className="font-medium text-primary mb-1">🦞 {t('docs.aiGuide.modes.openclaw.title')}</p>
                    <p className="text-xs text-secondary">{t('docs.aiGuide.modes.openclaw.desc')}</p>
                  </div>
                </div>
              </article>

              {/* AI-First API Design Principles */}
              <article id="ai-first-api" className="scroll-mt-20 mb-10">
                <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
                  <Sparkles size={18} className="text-accent" />
                  AI-First API Design
                </h3>
                <p className="text-secondary mb-4">
                  Baaton's API is designed from the ground up for AI agents, not just human developers. Every response is structured to make agentic workflows reliable and self-correcting.
                </p>

                <div className="space-y-4">
                  {/* Action hints */}
                  <div className="rounded-lg border border-border bg-surface p-4">
                    <h4 className="text-sm font-semibold text-primary mb-2 flex items-center gap-2">
                      <Zap size={14} className="text-accent" />
                      Action Hints — <code className="font-mono text-accent">recommendedNextAction</code>
                    </h4>
                    <p className="text-xs text-secondary mb-3">
                      Mutating responses include a <code className="text-primary bg-bg px-1 rounded">recommendedNextAction</code> field that tells the agent what to do next — eliminating guesswork.
                    </p>
                    <CodeBlock language="json">{`{
  "issue": { "id": "abc", "status": "todo", ... },
  "recommendedNextAction": {
    "action": "assign_to_sprint",
    "reason": "Issue has no sprint — add to active sprint for tracking",
    "endpoint": "PUT /sprints/:id",
    "hint": "Use GET /projects/:id/sprints to find the active sprint"
  }
}`}</CodeBlock>
                  </div>

                  {/* Context preservation */}
                  <div className="rounded-lg border border-border bg-surface p-4">
                    <h4 className="text-sm font-semibold text-primary mb-2 flex items-center gap-2">
                      <Database size={14} className="text-accent" />
                      Context Preservation
                    </h4>
                    <p className="text-xs text-secondary">
                      Responses always include parent context (project name, org slug, status labels) so agents don't need multiple round-trips to build a complete picture. A single <code className="text-primary bg-bg px-1 rounded">GET /issues/:id</code> returns the issue, its project, assignee details, comments, and TLDRs in one call.
                    </p>
                  </div>

                  {/* Rich error messages */}
                  <div className="rounded-lg border border-border bg-surface p-4">
                    <h4 className="text-sm font-semibold text-primary mb-2 flex items-center gap-2">
                      <AlertCircle size={14} className="text-accent" />
                      Rich Error Messages with Remediation Steps
                    </h4>
                    <p className="text-xs text-secondary mb-3">
                      Errors include machine-readable codes, human descriptions, and exact steps to fix them.
                    </p>
                    <CodeBlock language="json">{`{
  "error": "validation_error",
  "message": "Invalid status value",
  "field": "status",
  "accepted_values": ["backlog", "todo", "in_progress", "done", "cancelled"],
  "remediation": "Use GET /projects/:id to retrieve valid statuses for this project"
}`}</CodeBlock>
                  </div>

                  {/* Rate limit transparency */}
                  <div className="rounded-lg border border-border bg-surface p-4">
                    <h4 className="text-sm font-semibold text-primary mb-2 flex items-center gap-2">
                      <Timer size={14} className="text-accent" />
                      Rate Limit Transparency
                    </h4>
                    <p className="text-xs text-secondary mb-3">
                      Every response includes rate limit headers so agents can self-throttle.
                    </p>
                    <CodeBlock language="http">{`X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 847
X-RateLimit-Reset: 1710000000
Retry-After: 60   # only on 429`}</CodeBlock>
                  </div>

                  {/* Enum validation */}
                  <div className="rounded-lg border border-border bg-surface p-4">
                    <h4 className="text-sm font-semibold text-primary mb-2 flex items-center gap-2">
                      <Terminal size={14} className="text-accent" />
                      Enum Validation with <code className="font-mono">accepted_values</code>
                    </h4>
                    <p className="text-xs text-secondary">
                      When you pass an invalid enum (priority, type, status), the error response always includes <code className="text-primary bg-bg px-1 rounded">accepted_values</code> — the exact list of valid strings. No need to consult docs mid-loop.
                    </p>
                  </div>
                </div>
              </article>
            </section>

            <hr className="border-border mb-16" />

            {/* ═══════════════════════════════════════════════
                API REFERENCE
            ═══════════════════════════════════════════════ */}
            <section id="api-reference" className="scroll-mt-20 mb-16">
              <h2 className="flex items-center gap-2 text-2xl font-bold mb-2">
                <Server size={24} className="text-accent" />
                {t('docs.api.title')}
              </h2>
              <p className="text-secondary mb-8">{t('docs.api.subtitle')}</p>

              {/* ── Authentication ── */}
              <article id="api-auth" className="scroll-mt-20 mb-10">
                <h3 className="text-lg font-semibold mb-3">{t('docs.api.auth.title')}</h3>
                <p className="text-secondary mb-3">{t('docs.api.auth.desc')}</p>
                <CodeBlock language="bash">{`# Using API Key (recommended for agents)
curl -H "Authorization: Bearer baa_your_key_here" \\
  https://api.baaton.dev/api/v1/projects

# Using Clerk JWT (web app sessions)
curl -H "Authorization: Bearer <YOUR_CLERK_JWT>" \\
  https://api.baaton.dev/api/v1/projects`}</CodeBlock>
                <p className="mt-3 text-xs text-secondary">
                  API keys are org-scoped. Create them in <strong>Settings → API Keys</strong>.
                  Optionally restrict to specific project IDs. The secret is returned only once at creation.
                </p>
              </article>

              {/* ── Enums Reference ── */}
              <article className="scroll-mt-20 mb-10">
                <h3 className="text-lg font-semibold mb-3">Enums</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs font-semibold text-primary mb-2">Priority</p>
                    <div className="flex flex-wrap gap-1">
                      {['urgent','high','medium','low'].map(v => (
                        <code key={v} className="text-[10px] bg-surface rounded px-1.5 py-0.5 text-accent">{v}</code>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs font-semibold text-primary mb-2">Issue Type</p>
                    <div className="flex flex-wrap gap-1">
                      {['bug','feature','improvement','question'].map(v => (
                        <code key={v} className="text-[10px] bg-surface rounded px-1.5 py-0.5 text-accent">{v}</code>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs font-semibold text-primary mb-2">Status (default)</p>
                    <div className="flex flex-wrap gap-1">
                      {['backlog','todo','in_progress','in_review','done','cancelled'].map(v => (
                        <code key={v} className="text-[10px] bg-surface rounded px-1.5 py-0.5 text-accent">{v}</code>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs font-semibold text-primary mb-2">Relation Type</p>
                    <div className="flex flex-wrap gap-1">
                      {['blocks','blocked_by','relates_to','duplicates','duplicate_of'].map(v => (
                        <code key={v} className="text-[10px] bg-surface rounded px-1.5 py-0.5 text-accent">{v}</code>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs font-semibold text-primary mb-2">Recurrence</p>
                    <div className="flex flex-wrap gap-1">
                      {['daily','weekly','biweekly','monthly','custom'].map(v => (
                        <code key={v} className="text-[10px] bg-surface rounded px-1.5 py-0.5 text-accent">{v}</code>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs font-semibold text-primary mb-2">Automation Trigger</p>
                    <div className="flex flex-wrap gap-1">
                      {['issue_created','status_changed','priority_changed','assigned'].map(v => (
                        <code key={v} className="text-[10px] bg-surface rounded px-1.5 py-0.5 text-accent">{v}</code>
                      ))}
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-[10px] text-muted">
                  Statuses are per-project and customizable. Use <code className="text-accent">GET /projects/:id</code> to retrieve valid status values for a given project.
                </p>
              </article>

              {/* ── Agent-First docs link ── */}
              <article className="scroll-mt-20 mb-10">
                <h3 className="text-lg font-semibold mb-3">🤖 Machine-Readable API Docs</h3>
                <p className="text-secondary mb-3 text-sm">
                  A complete API reference is available as raw Markdown optimized for LLMs and coding agents:
                </p>
                <CodeBlock language="bash">{`curl https://api.baaton.dev/api/v1/public/docs
curl https://api.baaton.dev/api/v1/public/skill   # agent SKILL.md`}</CodeBlock>
                <p className="mt-2 text-xs text-muted">No authentication required. Returns Markdown formatted for AI consumption.</p>
              </article>

              {/* ── ALL ENDPOINTS TABLE ── */}
              <article id="api-endpoints" className="scroll-mt-20 mb-10">
                <h3 className="text-lg font-semibold mb-4">{t('docs.api.endpoints.title')}</h3>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm" role="table">
                    <thead>
                      <tr className="border-b border-border bg-surface">
                        <th className="px-4 py-2 text-left font-medium text-primary w-24">{t('docs.api.endpoints.method')}</th>
                        <th className="px-4 py-2 text-left font-medium text-primary">{t('docs.api.endpoints.path')}</th>
                        <th className="px-4 py-2 text-left font-medium text-primary">{t('docs.api.endpoints.description')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ALL_ENDPOINT_GROUPS.map((group) => (
                        <>
                          <CatRow key={`cat-${group.cat}`} label={group.cat} />
                          {group.endpoints.map((ep) => (
                            <tr key={`${ep.method}-${ep.path}`} className="border-b border-border/50 hover:bg-surface/40 transition-colors">
                              <td className="px-4 py-2"><Method type={ep.method} /></td>
                              <td className="px-4 py-2 font-mono text-xs text-primary/90">{ep.path}</td>
                              <td className="px-4 py-2 text-secondary text-xs">{ep.desc}</td>
                            </tr>
                          ))}
                        </>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-4 text-xs text-muted">
                  {t('docs.api.endpoints.baseUrl')}{' '}
                  <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-accent">
                    https://api.baaton.dev/api/v1
                  </code>
                </p>
              </article>

              {/* ════════ DETAILED SECTIONS ════════ */}

              {/* ── Projects ── */}
              <article id="api-projects" className="scroll-mt-20 mb-10">
                <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
                  <Database size={18} className="text-accent" />
                  Projects
                </h3>
                <p className="text-secondary text-sm mb-4">
                  Projects are the top-level containers for issues, sprints, cycles, and automations. Each project has a unique slug, customizable statuses, and optional GitHub repo mapping.
                </p>
                <CodeBlock language="bash">{`# List projects
curl https://api.baaton.dev/api/v1/projects \\
  -H "Authorization: Bearer baa_key"

# Create project
curl -X POST https://api.baaton.dev/api/v1/projects \\
  -H "Authorization: Bearer baa_key" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Backend API", "description": "API service issues"}'

# Update auto-assign rules (assign by tag or priority)
curl -X PATCH https://api.baaton.dev/api/v1/projects/:id/auto-assign \\
  -H "Authorization: Bearer baa_key" \\
  -H "Content-Type: application/json" \\
  -d '{"rules": [{"tag": "backend", "assignee_id": "user-uuid"}]}'

# Export all issues as JSON
curl https://api.baaton.dev/api/v1/projects/:id/export \\
  -H "Authorization: Bearer baa_key" > backup.json

# Import issues from JSON
curl -X POST https://api.baaton.dev/api/v1/projects/:id/import \\
  -H "Authorization: Bearer baa_key" \\
  -H "Content-Type: application/json" \\
  --data-binary @backup.json`}</CodeBlock>
              </article>

              {/* ── Issues ── */}
              <article id="api-issues" className="scroll-mt-20 mb-10">
                <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
                  <List size={18} className="text-accent" />
                  Issues
                </h3>
                <p className="text-secondary text-sm mb-4">
                  Issues are the core unit of Baaton. They support sub-issues (children), relations, attachments, comments, TLDRs, SLA tracking, and AI triage.
                </p>
                <CodeBlock language="bash">{`# Create an issue
curl -X POST https://api.baaton.dev/api/v1/issues \\
  -H "Authorization: Bearer baa_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "project_id": "uuid",
    "title": "Fix payment timeout",
    "description": "Stripe webhook times out after 10s",
    "priority": "high",
    "type": "bug",
    "assignee_id": "user-uuid",
    "parent_id": "parent-issue-uuid"   
  }'

# List all issues (with filters)
curl "https://api.baaton.dev/api/v1/issues?status=in_progress&priority=high" \\
  -H "Authorization: Bearer baa_key"

# Search by ticket ID or title
curl "https://api.baaton.dev/api/v1/issues?search=HLM-187" \\
  -H "Authorization: Bearer baa_key"

# Filter by date range
curl "https://api.baaton.dev/api/v1/issues?created_after=2026-03-20&created_before=2026-03-31" \\
  -H "Authorization: Bearer baa_key"

# List issues assigned to me
curl https://api.baaton.dev/api/v1/issues/mine \\
  -H "Authorization: Bearer baa_key"

# Batch update — close multiple issues at once
curl -X PATCH https://api.baaton.dev/api/v1/issues/batch \\
  -H "Authorization: Bearer baa_key" \\
  -H "Content-Type: application/json" \\
  -d '{"ids": ["id1","id2","id3"], "status": "done"}'

# AI Triage — auto-suggest priority, tags, assignee
curl -X POST https://api.baaton.dev/api/v1/issues/:id/triage \\
  -H "Authorization: Bearer baa_key"`}</CodeBlock>
              </article>

              {/* ── Comments & TLDRs ── */}
              <article id="api-comments" className="scroll-mt-20 mb-10">
                <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
                  <Bot size={18} className="text-accent" />
                  Comments &amp; TLDRs
                </h3>
                <p className="text-secondary text-sm mb-4">
                  Comments are user-facing discussion. TLDRs are agent-authored summaries — structured status updates ideal for standup reports and async handoffs.
                </p>
                <CodeBlock language="bash">{`# Add a comment
curl -X POST https://api.baaton.dev/api/v1/issues/:id/comments \\
  -H "Authorization: Bearer baa_key" \\
  -H "Content-Type: application/json" \\
  -d '{"body": "Fixed in commit abc123. Deploying to staging."}'
# author_name and author_id auto-filled from API key

# Post an agent TLDR
curl -X POST https://api.baaton.dev/api/v1/issues/:id/tldr \\
  -H "Authorization: Bearer baa_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "summary": "Root cause: race condition in payment processor",
    "status": "in_progress",
    "next_steps": ["Add distributed lock", "Deploy fix to staging"]
  }'`}</CodeBlock>
              </article>

              {/* ── Relations ── */}
              <article id="api-relations" className="scroll-mt-20 mb-10">
                <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
                  <LinkIcon size={18} className="text-accent" />
                  Relations &amp; Sub-issues
                </h3>
                <p className="text-secondary text-sm mb-4">
                  Issues can be linked with typed relations. Sub-issues are created by setting <code className="text-primary bg-surface px-1 rounded">parent_id</code> on issue creation.
                </p>
                <CodeBlock language="bash">{`# Create a relation
curl -X POST https://api.baaton.dev/api/v1/issues/:id/relations \\
  -H "Authorization: Bearer baa_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "related_issue_id": "other-issue-uuid",
    "relation_type": "blocks"
  }'
# relation_type: blocks | blocked_by | relates_to | duplicates | duplicate_of

# List sub-issues
curl https://api.baaton.dev/api/v1/issues/:id/children \\
  -H "Authorization: Bearer baa_key"`}</CodeBlock>
              </article>

              {/* ── Search ── */}
              <article id="api-search" className="scroll-mt-20 mb-10">
                <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
                  <Filter size={18} className="text-accent" />
                  Search
                </h3>
                <p className="text-secondary text-sm mb-4">
                  Full-text search across issues, comments, and TLDRs. Use <code className="text-primary bg-surface px-1 rounded">/search/global</code> to search across all accessible organizations.
                </p>
                <CodeBlock language="bash">{`# Search within org
curl "https://api.baaton.dev/api/v1/search?q=payment+timeout&project_id=uuid" \\
  -H "Authorization: Bearer baa_key"

# Global cross-org search
curl "https://api.baaton.dev/api/v1/search/global?q=memory+leak" \\
  -H "Authorization: Bearer baa_key"`}</CodeBlock>
              </article>

              {/* ── Cycles ── */}
              <article id="api-cycles" className="scroll-mt-20 mb-10">
                <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
                  <Layers size={18} className="text-accent" />
                  Cycles
                </h3>
                <p className="text-secondary text-sm mb-4">
                  Cycles are time-boxed work periods (like iterations). Issues are assigned to cycles for focused execution. Complete a cycle to close it and roll over unfinished work.
                </p>
                <CodeBlock language="bash">{`# List cycles for a project
curl https://api.baaton.dev/api/v1/projects/:id/cycles \\
  -H "Authorization: Bearer baa_key"

# Create a cycle
curl -X POST https://api.baaton.dev/api/v1/projects/:id/cycles \\
  -H "Authorization: Bearer baa_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Cycle 4",
    "start_date": "2026-03-15",
    "end_date": "2026-03-29"
  }'

# Complete a cycle (closes it, optional rollover of unfinished issues)
curl -X POST https://api.baaton.dev/api/v1/cycles/:id/complete \\
  -H "Authorization: Bearer baa_key" \\
  -H "Content-Type: application/json" \\
  -d '{"rollover": true}'`}</CodeBlock>
              </article>

              {/* ── Sprints ── */}
              <article id="api-sprints" className="scroll-mt-20 mb-10">
                <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
                  <Calendar size={18} className="text-accent" />
                  Sprints
                </h3>
                <p className="text-secondary text-sm mb-4">
                  Sprints are planning containers for issues, typically 1–2 weeks. Assign issues to sprints during planning; track velocity in Metrics.
                </p>
                <CodeBlock language="bash">{`# List sprints
curl https://api.baaton.dev/api/v1/projects/:id/sprints \\
  -H "Authorization: Bearer baa_key"

# Create a sprint
curl -X POST https://api.baaton.dev/api/v1/projects/:id/sprints \\
  -H "Authorization: Bearer baa_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Sprint 12",
    "start_date": "2026-03-17",
    "end_date": "2026-03-28",
    "goal": "Ship payment v2"
  }'

# Update a sprint (full replace)
curl -X PUT https://api.baaton.dev/api/v1/sprints/:id \\
  -H "Authorization: Bearer baa_key" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Sprint 12", "start_date": "2026-03-17", "end_date": "2026-03-28", "goal": "Updated goal"}'`}</CodeBlock>
              </article>

              {/* ── Milestones ── */}
              <article id="api-milestones" className="scroll-mt-20 mb-10">
                <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
                  <Target size={18} className="text-accent" />
                  Milestones
                </h3>
                <p className="text-secondary text-sm mb-4">
                  Milestones mark major deliverables or release targets. Issues are linked to milestones to track progress toward a deadline.
                </p>
                <CodeBlock language="bash">{`# List milestones for a project
curl https://api.baaton.dev/api/v1/projects/:id/milestones \\
  -H "Authorization: Bearer baa_key"

# Create a milestone
curl -X POST https://api.baaton.dev/api/v1/projects/:id/milestones \\
  -H "Authorization: Bearer baa_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "v2.0 Launch",
    "description": "Full payment system rewrite",
    "due_date": "2026-04-30"
  }'

# Get milestone with progress
curl https://api.baaton.dev/api/v1/milestones/:id \\
  -H "Authorization: Bearer baa_key"
# Returns: { "milestone": {...}, "progress": 0.67, "open_issues": 4, "closed_issues": 8 }`}</CodeBlock>
              </article>

              {/* ── Views ── */}
              <article id="api-views" className="scroll-mt-20 mb-10">
                <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
                  <Filter size={18} className="text-accent" />
                  Views (Saved Filters)
                </h3>
                <p className="text-secondary text-sm mb-4">
                  Views are saved filter presets. Create a view once; call <code className="text-primary bg-surface px-1 rounded">/views/:id/issues</code> to execute it and retrieve matching issues instantly.
                </p>
                <CodeBlock language="bash">{`# Create a saved view
curl -X POST https://api.baaton.dev/api/v1/views \\
  -H "Authorization: Bearer baa_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "High Priority Open",
    "filters": {
      "priority": ["urgent", "high"],
      "status": ["todo", "in_progress"],
      "project_id": "uuid"
    }
  }'

# Execute a view — returns matching issues
curl https://api.baaton.dev/api/v1/views/:id/issues \\
  -H "Authorization: Bearer baa_key"`}</CodeBlock>
              </article>

              {/* ── Activity Feed ── */}
              <article id="api-activity" className="scroll-mt-20 mb-10">
                <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
                  <Activity size={18} className="text-accent" />
                  Activity Feed
                </h3>
                <p className="text-secondary text-sm mb-4">
                  The activity feed tracks every change — status transitions, field edits, comments, assignments. Use it for audit trails, changelogs, or agent context injection.
                </p>
                <CodeBlock language="bash">{`# Recent org-wide activity (last 50 events)
curl "https://api.baaton.dev/api/v1/activity?limit=50" \\
  -H "Authorization: Bearer baa_key"

# Full activity timeline for an issue
curl https://api.baaton.dev/api/v1/issues/:id/activity \\
  -H "Authorization: Bearer baa_key"
# Returns: [{ "event": "status_changed", "from": "todo", "to": "in_progress",
#              "actor": "agent-name", "timestamp": "2026-03-12T10:00:00Z" }, ...]`}</CodeBlock>
              </article>

              {/* ── Attachments ── */}
              <article id="api-attachments" className="scroll-mt-20 mb-10">
                <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
                  <Upload size={18} className="text-accent" />
                  Attachments
                </h3>
                <p className="text-secondary text-sm mb-4">
                  Upload files, screenshots, or logs to issues. Accepts base64-encoded content up to <strong>20 MB</strong>.
                </p>
                <CodeBlock language="bash">{`# Upload an attachment (base64)
curl -X POST https://api.baaton.dev/api/v1/issues/:id/attachments \\
  -H "Authorization: Bearer baa_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "filename": "error-log.txt",
    "content_type": "text/plain",
    "data": "base64encodedcontent..."
  }'

# List attachments
curl https://api.baaton.dev/api/v1/issues/:id/attachments \\
  -H "Authorization: Bearer baa_key"

# Delete attachment
curl -X DELETE https://api.baaton.dev/api/v1/issues/:id/attachments/:att_id \\
  -H "Authorization: Bearer baa_key"`}</CodeBlock>
              </article>

              {/* ── Archive ── */}
              <article id="api-archive" className="scroll-mt-20 mb-10">
                <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
                  <Archive size={18} className="text-accent" />
                  Archive
                </h3>
                <p className="text-secondary text-sm mb-4">
                  Archive hides issues from default views without deleting them. Useful for stale or parked issues. Unarchive to restore them.
                </p>
                <CodeBlock language="bash">{`# Archive an issue
curl -X POST https://api.baaton.dev/api/v1/issues/:id/archive \\
  -H "Authorization: Bearer baa_key"

# Unarchive
curl -X POST https://api.baaton.dev/api/v1/issues/:id/unarchive \\
  -H "Authorization: Bearer baa_key"`}</CodeBlock>
              </article>

              {/* ── Notifications ── */}
              <article id="api-notifications" className="scroll-mt-20 mb-10">
                <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
                  <Bell size={18} className="text-accent" />
                  Notifications
                </h3>
                <p className="text-secondary text-sm mb-4">
                  User-level notification inbox. Agents can poll for notifications or set preferences to filter the signal.
                </p>
                <CodeBlock language="bash">{`# Get unread count (cheap poll)
curl https://api.baaton.dev/api/v1/notifications/count \\
  -H "Authorization: Bearer baa_key"

# List notifications
curl "https://api.baaton.dev/api/v1/notifications?unread=true" \\
  -H "Authorization: Bearer baa_key"

# Mark all as read
curl -X POST https://api.baaton.dev/api/v1/notifications/read-all \\
  -H "Authorization: Bearer baa_key"

# Update preferences
curl -X PATCH https://api.baaton.dev/api/v1/notifications/preferences \\
  -H "Authorization: Bearer baa_key" \\
  -H "Content-Type: application/json" \\
  -d '{"email": true, "slack": false, "events": ["status.changed", "comment.created"]}'`}</CodeBlock>
              </article>

              {/* ── API Keys ── */}
              <article id="api-keys-section" className="scroll-mt-20 mb-10">
                <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
                  <Key size={18} className="text-accent" />
                  API Keys
                </h3>
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 mb-4">
                  <p className="text-xs text-amber-400 font-medium">⚠️  The <code className="font-mono">secret</code> field is returned ONLY once, at creation time. Store it immediately — it cannot be retrieved again.</p>
                </div>
                <p className="text-secondary text-sm mb-4">
                  API keys authenticate agents and CI pipelines. They are org-scoped but can be optionally restricted to specific project IDs.
                </p>
                <CodeBlock language="bash">{`# List all keys (secrets hidden)
curl https://api.baaton.dev/api/v1/api-keys \\
  -H "Authorization: Bearer baa_key"

# Create a new key
curl -X POST https://api.baaton.dev/api/v1/api-keys \\
  -H "Authorization: Bearer baa_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "prod-agent-v3",
    "project_ids": ["uuid-1", "uuid-2"]
  }'
# Response includes "secret": "baa_xxxxxxxxxxxx" — save this immediately!

# Revoke a key
curl -X DELETE https://api.baaton.dev/api/v1/api-keys/:id \\
  -H "Authorization: Bearer baa_key"`}</CodeBlock>
              </article>

              {/* ── Webhooks ── */}
              <article id="api-webhooks" className="scroll-mt-20 mb-10">
                <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
                  <Webhook size={18} className="text-accent" />
                  Webhooks (Baaton)
                </h3>
                <p className="text-secondary text-sm mb-4">
                  Register HTTP endpoints to receive real-time Baaton events. Deliveries are signed with HMAC-SHA256 for verification.
                </p>
                <CodeBlock language="bash">{`# Create a webhook
curl -X POST https://api.baaton.dev/api/v1/webhooks \\
  -H "Authorization: Bearer baa_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://your-agent.example.com/events",
    "event_types": ["issue.created", "status.changed", "comment.created"],
    "enabled": true
  }'
# Returns: { "id": "...", "secret": "whsec_..." }  ← save the secret!

# List webhooks
curl https://api.baaton.dev/api/v1/webhooks \\
  -H "Authorization: Bearer baa_key"

# Update — pause a webhook
curl -X PATCH https://api.baaton.dev/api/v1/webhooks/:id \\
  -H "Authorization: Bearer baa_key" \\
  -H "Content-Type: application/json" \\
  -d '{"enabled": false}'`}</CodeBlock>
              </article>

              {/* ── Billing ── */}
              <article id="api-billing" className="scroll-mt-20 mb-10">
                <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
                  <CreditCard size={18} className="text-accent" />
                  Billing &amp; Plans
                </h3>
                <p className="text-secondary text-sm mb-4">
                  Retrieve current plan details, per-seat usage, and feature limits. Useful for agents to self-check quota before bulk operations.
                </p>
                <CodeBlock language="bash">{`# Get billing info
curl https://api.baaton.dev/api/v1/billing \\
  -H "Authorization: Bearer baa_key"

# Response:
# {
#   "plan": "pro",
#   "seats": { "used": 8, "limit": 20 },
#   "issues": { "used": 2341, "limit": null },
#   "api_calls_today": { "used": 450, "limit": 5000 }
# }`}</CodeBlock>
              </article>

            </section>

            <hr className="border-border mb-16" />

            {/* ═══ PHILOSOPHY ═══════════════ */}
            <section id="philosophy" className="scroll-mt-20 mb-16">
              <h2 className="flex items-center gap-2 text-2xl font-bold mb-2">
                💡 Philosophy
              </h2>
              <p className="text-secondary mb-6">
                Baaton is built for a world where AI agents are first-class project participants — not just tools that humans use, but autonomous collaborators that create, update, and close issues alongside human teammates.
              </p>

              <div className="space-y-6">
                <div className="rounded-lg border border-border bg-surface p-5">
                  <h3 className="text-sm font-semibold text-primary mb-2">🤖 Agent-First, Not Agent-Only</h3>
                  <p className="text-xs text-secondary">Every API endpoint returns structured, actionable data with contextual hints. AI agents receive <code className="text-primary bg-surface px-1 rounded">_hints</code> in responses that suggest what to do next — like adding a TLDR when closing an issue or explaining a reprioritization. Humans get the same great UI.</p>
                </div>

                <div className="rounded-lg border border-border bg-surface p-5">
                  <h3 className="text-sm font-semibold text-primary mb-2">🔑 API Keys as Identity</h3>
                  <p className="text-xs text-secondary">Each API key carries a name that auto-populates comments and activity logs. When your agent writes "Fixed: resolved the auth timeout", the comment shows who said it — the agent, not a generic bot.</p>
                </div>

                <div className="rounded-lg border border-border bg-surface p-5">
                  <h3 className="text-sm font-semibold text-primary mb-2">📡 Event-Driven, Not Polling</h3>
                  <p className="text-xs text-secondary">Webhooks with HMAC-SHA256 signatures deliver events in real-time. No polling loops, no wasted API calls. Automations react to triggers instantly.</p>
                </div>

                <div className="rounded-lg border border-border bg-surface p-5">
                  <h3 className="text-sm font-semibold text-primary mb-2">🧠 Rich Error Context</h3>
                  <p className="text-xs text-secondary">Errors include remediation steps and accepted values — so agents can self-correct without guessing. A 422 response tells you exactly which field is wrong and what values are valid.</p>
                </div>

                <div className="rounded-lg border border-border bg-surface p-5">
                  <h3 className="text-sm font-semibold text-primary mb-2">🏗️ Open & Self-Hostable</h3>
                  <p className="text-xs text-secondary">Baaton is open-source. Run it on your own infrastructure. The SKILL.md file means any agent framework (OpenClaw, Claude Code, Cursor, Codex) can integrate in minutes.</p>
                </div>
              </div>
            </section>

            <hr className="border-border mb-16" />

            {/* ═══ CONTRIBUTING ═══════════════ */}
            <section id="contributing" className="scroll-mt-20 mb-16">
              <h2 className="flex items-center gap-2 text-2xl font-bold mb-2">
                🤝 Contributing
              </h2>
              <p className="text-secondary mb-6">
                Baaton is built in the open. Contributions are welcome — whether it's a bug fix, new feature, documentation improvement, or AI skill enhancement.
              </p>

              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-primary mb-2">Getting Started</h3>
                  <ol className="list-decimal list-inside space-y-1 text-secondary text-sm">
                    <li>Fork the repository on GitHub</li>
                    <li>Clone and install dependencies</li>
                    <li>Create a feature branch (<code className="text-primary bg-surface px-1 rounded">git checkout -b feat/my-feature</code>)</li>
                    <li>Make your changes with tests</li>
                    <li>Submit a pull request</li>
                  </ol>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-primary mb-2">Tech Stack</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded-lg border border-border bg-surface p-3 text-center">
                      <p className="text-xs font-semibold text-primary">Backend</p>
                      <p className="text-[10px] text-secondary mt-1">Rust / Axum</p>
                    </div>
                    <div className="rounded-lg border border-border bg-surface p-3 text-center">
                      <p className="text-xs font-semibold text-primary">Frontend</p>
                      <p className="text-[10px] text-secondary mt-1">React 19 / Vite</p>
                    </div>
                    <div className="rounded-lg border border-border bg-surface p-3 text-center">
                      <p className="text-xs font-semibold text-primary">Database</p>
                      <p className="text-[10px] text-secondary mt-1">PostgreSQL</p>
                    </div>
                    <div className="rounded-lg border border-border bg-surface p-3 text-center">
                      <p className="text-xs font-semibold text-primary">AI</p>
                      <p className="text-[10px] text-secondary mt-1">Gemini / OpenClaw</p>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-primary mb-2">Areas to Contribute</h3>
                  <ul className="list-disc list-inside space-y-1 text-secondary text-sm">
                    <li><strong>AI Skills</strong> — write new skills for agent frameworks (Claude, GPT, Gemini)</li>
                    <li><strong>Integrations</strong> — GitHub, Slack, Discord, Linear import</li>
                    <li><strong>i18n</strong> — add new languages (currently: English, French)</li>
                    <li><strong>Documentation</strong> — improve guides, add examples, translate docs</li>
                    <li><strong>Automations</strong> — new trigger types and action handlers</li>
                  </ul>
                </div>

                <div className="rounded-lg border border-accent/20 bg-accent/5 p-4">
                  <p className="text-xs text-secondary">
                    <strong className="text-primary">Questions?</strong> Open an issue on GitHub or reach out at{' '}
                    <a href="mailto:haros@agentmail.to" className="text-accent hover:underline">haros@agentmail.to</a>
                  </p>
                </div>
              </div>
            </section>

            {/* ── Footer ───────────────────── */}
            <footer className="border-t border-border pt-8 pb-16 text-center text-xs text-muted">
              <p>{t('docs.footer')}</p>
              <div className="mt-3 flex items-center justify-center gap-4">
                <Link to="/" className="hover:text-accent transition-colors flex items-center gap-1">
                  {t('docs.footerHome')} <ExternalLink size={12} />
                </Link>
                <Link to="/sign-up" className="hover:text-accent transition-colors flex items-center gap-1">
                  {t('docs.footerSignUp')} <ExternalLink size={12} />
                </Link>
              </div>
            </footer>
          </div>
        </main>
      </div>

      {/* ── Scroll-to-top ──────────────────── */}
      {showScrollTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-6 right-6 z-40 rounded-full bg-surface border border-border p-2 text-secondary hover:text-primary hover:bg-surface-hover transition-all shadow-lg"
          aria-label={t('docs.scrollTop')}
        >
          <ArrowUp size={18} />
        </button>
      )}
    </div>
  );
}

export default Docs;
