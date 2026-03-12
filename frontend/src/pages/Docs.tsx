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
} from 'lucide-react';

/* ─── Types ────────────────────────────────── */
interface NavSection {
  id: string;
  labelKey: string;
  icon: React.ReactNode;
  children: { id: string; labelKey: string }[];
}

/* ─── Navigation Structure ────────────────── */
const NAV: NavSection[] = [
  {
    id: 'agent-onboarding',
    labelKey: 'Agent Onboarding',
    icon: <Bot size={16} />,
    children: [
      { id: 'agent-quickstart', labelKey: 'Quick Start' },
      { id: 'agent-api-keys', labelKey: 'API Keys' },
      { id: 'agent-webhooks', labelKey: 'Webhooks' },
      { id: 'agent-metrics', labelKey: 'Metrics' },
    ],
  },
  {
    id: 'getting-started',
    labelKey: 'docs.nav.gettingStarted',
    icon: <Rocket size={16} />,
    children: [
      { id: 'signup', labelKey: 'docs.nav.signup' },
      { id: 'first-project', labelKey: 'docs.nav.firstProject' },
      { id: 'create-issues', labelKey: 'docs.nav.createIssues' },
    ],
  },
  {
    id: 'features',
    labelKey: 'docs.nav.features',
    icon: <BookOpen size={16} />,
    children: [
      { id: 'kanban', labelKey: 'docs.nav.kanban' },
      { id: 'list-view', labelKey: 'docs.nav.listView' },
      { id: 'ai-assistant', labelKey: 'docs.nav.aiAssistant' },
      { id: 'issue-drawer', labelKey: 'docs.nav.issueDrawer' },
      { id: 'theming', labelKey: 'docs.nav.theming' },
      { id: 'i18n', labelKey: 'docs.nav.i18n' },
      { id: 'shortcuts', labelKey: 'docs.nav.shortcuts' },
      { id: 'deep-links', labelKey: 'docs.nav.deepLinks' },
    ],
  },
  {
    id: 'integrations',
    labelKey: 'docs.nav.integrations',
    icon: <Plug size={16} />,
    children: [
      { id: 'agent-skill', labelKey: 'docs.nav.agentSkill' },
      { id: 'openclaw', labelKey: 'docs.nav.openclaw' },
      { id: 'github-app', labelKey: 'docs.nav.githubApp' },
      { id: 'microsoft-sso', labelKey: 'docs.nav.microsoftSso' },
    ],
  },
  {
    id: 'ai-guide',
    labelKey: 'docs.nav.aiGuide',
    icon: <Brain size={16} />,
    children: [
      { id: 'ai-skills', labelKey: 'docs.nav.aiSkills' },
      { id: 'ai-prompts', labelKey: 'docs.nav.aiPrompts' },
      { id: 'ai-modes', labelKey: 'docs.nav.aiModes' },
    ],
  },
  {
    id: 'api-reference',
    labelKey: 'docs.nav.apiReference',
    icon: <Server size={16} />,
    children: [
      { id: 'api-auth', labelKey: 'docs.nav.apiAuth' },
      { id: 'api-endpoints', labelKey: 'docs.nav.apiEndpoints' },
    ],
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

/* ─── Docs Page ───────────────────────────── */
export function Docs() {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState('getting-started');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);

  // All section IDs for intersection observer
  const allIds = useMemo(
    () => NAV.flatMap((s) => [s.id, ...s.children.map((c) => c.id)]),
    [],
  );

  // Track which section is in view
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
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

  // Show scroll-to-top after scrolling down
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
            {/* Mobile nav toggle */}
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
            {/* ═══ AGENT ONBOARDING ═══════════ */}
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
                  <li>Auto-fills <code className="text-primary bg-surface px-1 rounded">created_by_name</code> from key name</li>
                  <li>Comments: <code className="text-primary bg-surface px-1 rounded">author_id</code>/<code className="text-primary bg-surface px-1 rounded">author_name</code> are auto-populated</li>
                </ul>
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

            {/* ═══ GETTING STARTED ═══════════ */}
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

            {/* ═══ FEATURES ═════════════════ */}
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

            {/* ═══ INTEGRATIONS ═════════════ */}
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

            {/* ═══ AI ASSISTANT GUIDE ════════ */}
            <section id="ai-guide" className="scroll-mt-20 mb-16">
              <h2 className="flex items-center gap-2 text-2xl font-bold mb-2">
                <Brain size={24} className="text-accent" />
                {t('docs.aiGuide.title')}
              </h2>
              <p className="text-secondary mb-8">{t('docs.aiGuide.subtitle')}</p>

              <article id="ai-skills" className="scroll-mt-20 mb-10">
                <h3 className="text-lg font-semibold mb-4">{t('docs.aiGuide.skills.title')}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
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
                  ].map(({ icon, key }) => (
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
                </div>
              </article>

              <article id="ai-prompts" className="scroll-mt-20 mb-10">
                <h3 className="text-lg font-semibold mb-4">{t('docs.aiGuide.prompts.title')}</h3>
                <div className="space-y-3">
                  {['prompt1', 'prompt2', 'prompt3', 'prompt4', 'prompt5'].map((key) => (
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
            </section>

            <hr className="border-border mb-16" />

            {/* ═══ API REFERENCE ═════════════ */}
            <section id="api-reference" className="scroll-mt-20 mb-16">
              <h2 className="flex items-center gap-2 text-2xl font-bold mb-2">
                <Server size={24} className="text-accent" />
                {t('docs.api.title')}
              </h2>
              <p className="text-secondary mb-8">{t('docs.api.subtitle')}</p>

              <article id="api-auth" className="scroll-mt-20 mb-10">
                <h3 className="text-lg font-semibold mb-3">{t('docs.api.auth.title')}</h3>
                <p className="text-secondary mb-3">{t('docs.api.auth.desc')}</p>
                <CodeBlock language="bash">{`# Using API Key (recommended for agents)
curl -H "Authorization: Bearer baa_your_key_here" \\
  https://api.baaton.dev/api/v1/projects

# Using Clerk JWT (for web app)
curl -H "Authorization: Bearer <YOUR_CLERK_JWT>" \\
  https://api.baaton.dev/api/v1/projects`}</CodeBlock>
                <p className="mt-3 text-xs text-secondary">API keys are org-scoped. Create them in Settings → API Keys. Optionally restrict to specific projects.</p>
              </article>

              {/* Enums Reference */}
              <article className="scroll-mt-20 mb-10">
                <h3 className="text-lg font-semibold mb-3">Enums</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs font-semibold text-primary mb-2">Priority</p>
                    <div className="flex flex-wrap gap-1">{['urgent','high','medium','low'].map(v => <code key={v} className="text-[10px] bg-surface rounded px-1.5 py-0.5 text-accent">{v}</code>)}</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs font-semibold text-primary mb-2">Issue Type</p>
                    <div className="flex flex-wrap gap-1">{['bug','feature','improvement','question'].map(v => <code key={v} className="text-[10px] bg-surface rounded px-1.5 py-0.5 text-accent">{v}</code>)}</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs font-semibold text-primary mb-2">Status (default)</p>
                    <div className="flex flex-wrap gap-1">{['backlog','todo','in_progress','in_review','done','cancelled'].map(v => <code key={v} className="text-[10px] bg-surface rounded px-1.5 py-0.5 text-accent">{v}</code>)}</div>
                  </div>
                </div>
                <p className="mt-2 text-[10px] text-muted">Statuses are per-project. Use GET /projects to see valid statuses for each project.</p>
              </article>

              {/* Agent-first docs link */}
              <article className="scroll-mt-20 mb-10">
                <h3 className="text-lg font-semibold mb-3">🤖 Agent-First API Docs (Markdown)</h3>
                <p className="text-secondary mb-3 text-sm">For LLMs and coding agents, a complete API reference is available as raw Markdown:</p>
                <CodeBlock language="bash">{`curl https://api.baaton.dev/api/v1/public/docs`}</CodeBlock>
                <p className="mt-2 text-xs text-muted">Returns the full API reference in Markdown format — optimized for AI agents. No authentication required.</p>
              </article>

              <article id="api-endpoints" className="scroll-mt-20 mb-10">
                <h3 className="text-lg font-semibold mb-4">{t('docs.api.endpoints.title')}</h3>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm" role="table">
                    <thead>
                      <tr className="border-b border-border bg-surface">
                        <th className="px-4 py-2 text-left font-medium text-primary">{t('docs.api.endpoints.method')}</th>
                        <th className="px-4 py-2 text-left font-medium text-primary">{t('docs.api.endpoints.path')}</th>
                        <th className="px-4 py-2 text-left font-medium text-primary">{t('docs.api.endpoints.description')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border text-secondary">
                      <tr><td className="px-4 py-2"><span className="rounded bg-emerald-900/30 px-1.5 py-0.5 text-xs font-mono text-emerald-400">GET</span></td><td className="px-4 py-2 font-mono text-xs">/projects</td><td className="px-4 py-2">{t('docs.api.endpoints.listProjects')}</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-blue-900/30 px-1.5 py-0.5 text-xs font-mono text-blue-400">POST</span></td><td className="px-4 py-2 font-mono text-xs">/projects</td><td className="px-4 py-2">{t('docs.api.endpoints.createProject')}</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-emerald-900/30 px-1.5 py-0.5 text-xs font-mono text-emerald-400">GET</span></td><td className="px-4 py-2 font-mono text-xs">/projects/:id/issues</td><td className="px-4 py-2">{t('docs.api.endpoints.listIssues')}</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-emerald-900/30 px-1.5 py-0.5 text-xs font-mono text-emerald-400">GET</span></td><td className="px-4 py-2 font-mono text-xs">/issues</td><td className="px-4 py-2">List all issues across projects</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-blue-900/30 px-1.5 py-0.5 text-xs font-mono text-blue-400">POST</span></td><td className="px-4 py-2 font-mono text-xs">/issues</td><td className="px-4 py-2">{t('docs.api.endpoints.createIssue')}</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-emerald-900/30 px-1.5 py-0.5 text-xs font-mono text-emerald-400">GET</span></td><td className="px-4 py-2 font-mono text-xs">/issues/:id</td><td className="px-4 py-2">Get issue with TLDRs & comments</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-amber-900/30 px-1.5 py-0.5 text-xs font-mono text-amber-400">PATCH</span></td><td className="px-4 py-2 font-mono text-xs">/issues/:id</td><td className="px-4 py-2">{t('docs.api.endpoints.updateIssue')}</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-red-900/30 px-1.5 py-0.5 text-xs font-mono text-red-400">DELETE</span></td><td className="px-4 py-2 font-mono text-xs">/issues/:id</td><td className="px-4 py-2">Delete an issue</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-emerald-900/30 px-1.5 py-0.5 text-xs font-mono text-emerald-400">GET</span></td><td className="px-4 py-2 font-mono text-xs">/issues/:id/comments</td><td className="px-4 py-2">{t('docs.api.endpoints.listComments')}</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-blue-900/30 px-1.5 py-0.5 text-xs font-mono text-blue-400">POST</span></td><td className="px-4 py-2 font-mono text-xs">/issues/:id/comments</td><td className="px-4 py-2">{t('docs.api.endpoints.addComment')} (author auto-filled from API key)</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-red-900/30 px-1.5 py-0.5 text-xs font-mono text-red-400">DELETE</span></td><td className="px-4 py-2 font-mono text-xs">/issues/:id/comments/:cid</td><td className="px-4 py-2">Delete a comment</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-blue-900/30 px-1.5 py-0.5 text-xs font-mono text-blue-400">POST</span></td><td className="px-4 py-2 font-mono text-xs">/issues/:id/tldr</td><td className="px-4 py-2">Add agent summary (TLDR)</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-emerald-900/30 px-1.5 py-0.5 text-xs font-mono text-emerald-400">GET</span></td><td className="px-4 py-2 font-mono text-xs">/projects/:id/tags</td><td className="px-4 py-2">{t('docs.api.endpoints.listTags')}</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-emerald-900/30 px-1.5 py-0.5 text-xs font-mono text-emerald-400">GET</span></td><td className="px-4 py-2 font-mono text-xs">/public/docs</td><td className="px-4 py-2">API reference (Markdown, no auth)</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-emerald-900/30 px-1.5 py-0.5 text-xs font-mono text-emerald-400">GET</span></td><td className="px-4 py-2 font-mono text-xs">/webhooks</td><td className="px-4 py-2">List webhook endpoints</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-blue-900/30 px-1.5 py-0.5 text-xs font-mono text-blue-400">POST</span></td><td className="px-4 py-2 font-mono text-xs">/webhooks</td><td className="px-4 py-2">Create a webhook endpoint (secret returned once)</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-amber-900/30 px-1.5 py-0.5 text-xs font-mono text-amber-400">PATCH</span></td><td className="px-4 py-2 font-mono text-xs">/webhooks/:id</td><td className="px-4 py-2">Update url, event_types, or enabled status</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-red-900/30 px-1.5 py-0.5 text-xs font-mono text-red-400">DELETE</span></td><td className="px-4 py-2 font-mono text-xs">/webhooks/:id</td><td className="px-4 py-2">Delete a webhook endpoint</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-emerald-900/30 px-1.5 py-0.5 text-xs font-mono text-emerald-400">GET</span></td><td className="px-4 py-2 font-mono text-xs">/metrics?days=30</td><td className="px-4 py-2">Issue activity stats (created, closed, resolution time)</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-blue-900/30 px-1.5 py-0.5 text-xs font-mono text-blue-400">POST</span></td><td className="px-4 py-2 font-mono text-xs">/issues/:id/triage</td><td className="px-4 py-2">AI-powered triage (suggests priority, tags, assignee)</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-emerald-900/30 px-1.5 py-0.5 text-xs font-mono text-emerald-400">GET</span></td><td className="px-4 py-2 font-mono text-xs">/search/global?q=</td><td className="px-4 py-2">Cross-org full-text search</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-emerald-900/30 px-1.5 py-0.5 text-xs font-mono text-emerald-400">GET</span></td><td className="px-4 py-2 font-mono text-xs">/initiatives</td><td className="px-4 py-2">List strategic initiatives</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-blue-900/30 px-1.5 py-0.5 text-xs font-mono text-blue-400">POST</span></td><td className="px-4 py-2 font-mono text-xs">/initiatives</td><td className="px-4 py-2">Create initiative (name, description)</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-emerald-900/30 px-1.5 py-0.5 text-xs font-mono text-emerald-400">GET</span></td><td className="px-4 py-2 font-mono text-xs">/projects/:id/automations</td><td className="px-4 py-2">List workflow automations</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-blue-900/30 px-1.5 py-0.5 text-xs font-mono text-blue-400">POST</span></td><td className="px-4 py-2 font-mono text-xs">/projects/:id/automations</td><td className="px-4 py-2">Create automation (trigger → action)</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-emerald-900/30 px-1.5 py-0.5 text-xs font-mono text-emerald-400">GET</span></td><td className="px-4 py-2 font-mono text-xs">/projects/:id/sla-rules</td><td className="px-4 py-2">List SLA rules per priority</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-emerald-900/30 px-1.5 py-0.5 text-xs font-mono text-emerald-400">GET</span></td><td className="px-4 py-2 font-mono text-xs">/projects/:id/sla-stats</td><td className="px-4 py-2">SLA achievement %, on-time, breached</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-emerald-900/30 px-1.5 py-0.5 text-xs font-mono text-emerald-400">GET</span></td><td className="px-4 py-2 font-mono text-xs">/projects/:id/templates</td><td className="px-4 py-2">List issue templates</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-emerald-900/30 px-1.5 py-0.5 text-xs font-mono text-emerald-400">GET</span></td><td className="px-4 py-2 font-mono text-xs">/projects/:id/recurring</td><td className="px-4 py-2">List recurring issue configs</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-emerald-900/30 px-1.5 py-0.5 text-xs font-mono text-emerald-400">GET</span></td><td className="px-4 py-2 font-mono text-xs">/projects/:id/export</td><td className="px-4 py-2">Export project issues as JSON</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-blue-900/30 px-1.5 py-0.5 text-xs font-mono text-blue-400">POST</span></td><td className="px-4 py-2 font-mono text-xs">/projects/:id/import</td><td className="px-4 py-2">Import issues from JSON</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-amber-900/30 px-1.5 py-0.5 text-xs font-mono text-amber-400">PATCH</span></td><td className="px-4 py-2 font-mono text-xs">/issues/batch</td><td className="px-4 py-2">Batch update issues (status, priority, assignee)</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-emerald-900/30 px-1.5 py-0.5 text-xs font-mono text-emerald-400">GET</span></td><td className="px-4 py-2 font-mono text-xs">/issues/:id/relations</td><td className="px-4 py-2">List issue relations (blocks, relates_to, etc.)</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-emerald-900/30 px-1.5 py-0.5 text-xs font-mono text-emerald-400">GET</span></td><td className="px-4 py-2 font-mono text-xs">/issues/:id/children</td><td className="px-4 py-2">List sub-issues</td></tr>
                      <tr><td className="px-4 py-2"><span className="rounded bg-emerald-900/30 px-1.5 py-0.5 text-xs font-mono text-emerald-400">GET</span></td><td className="px-4 py-2 font-mono text-xs">/notifications</td><td className="px-4 py-2">List notifications for current user</td></tr>
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
