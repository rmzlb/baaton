import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Sun, Moon, LayoutDashboard, Bot, User, Check,
  MoreHorizontal, Loader, Inbox, Cpu, Gavel, Copy,
  Menu, X, Rocket, Users, Layers, MessageCircle,
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher';

function useTheme() {
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (localStorage.theme === 'dark') return true;
    if (localStorage.theme === 'light') return false;
    return false; // Light mode by default
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.theme = dark ? 'dark' : 'light';
  }, [dark]);
  return { dark, toggle: () => setDark(d => !d) };
}

/* ─── Code Tabs Component ──────────────────── */
const codeSnippets: Record<string, string> = {
  cURL: `curl -X POST https://api.baaton.dev/api/v1/issues \\
  -H "Authorization: Bearer baa_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "project_id": "your-project-id",
    "title": "Fix auth timeout bug",
    "status": "todo",
    "priority": "high"
  }'`,
  Python: `import requests

resp = requests.post(
    "https://api.baaton.dev/api/v1/issues",
    headers={"Authorization": "Bearer baa_your_key"},
    json={
        "project_id": "your-project-id",
        "title": "Fix auth timeout bug",
        "status": "todo",
        "priority": "high",
    },
)
print(resp.json()["data"]["display_id"])`,
  TypeScript: `const resp = await fetch(
  "https://api.baaton.dev/api/v1/issues",
  {
    method: "POST",
    headers: {
      "Authorization": "Bearer baa_your_key",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      project_id: "your-project-id",
      title: "Fix auth timeout bug",
      status: "todo",
      priority: "high",
    }),
  }
);
const { data } = await resp.json();`,
};

function CodeTabs() {
  const [tab, setTab] = useState<string>('cURL');
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(codeSnippets[tab]);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="w-full max-w-2xl mx-auto mt-12 rounded-xl border border-black/10 dark:border-white/10 bg-[#1a1a1a] dark:bg-[#0A0A0A] overflow-hidden text-left opacity-0 animate-fade-in-delay shadow-2xl">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 bg-black/20">
        <div className="flex gap-1">
          {Object.keys(codeSnippets).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 rounded-md text-xs font-bold transition-colors ${
                tab === t ? 'bg-amber-500/15 text-amber-500' : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <button onClick={handleCopy} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-neutral-500 hover:text-white transition-colors">
          {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-[13px] leading-relaxed">
        <code className="text-emerald-300/90 font-mono">{codeSnippets[tab]}</code>
      </pre>
    </div>
  );
}

/* ─── Use Cases Data ───────────────────────── */
const useCasesConfig = [
  { icon: Rocket, titleKey: 'landing.useCases.coding', descKey: 'landing.useCases.codingDesc', color: 'text-blue-400', bg: 'bg-blue-500/10 dark:bg-blue-500/10' },
  { icon: Users, titleKey: 'landing.useCases.qa', descKey: 'landing.useCases.qaDesc', color: 'text-green-400', bg: 'bg-green-500/10 dark:bg-green-500/10' },
  { icon: Layers, titleKey: 'landing.useCases.devops', descKey: 'landing.useCases.devopsDesc', color: 'text-purple-400', bg: 'bg-purple-500/10 dark:bg-purple-500/10' },
  { icon: MessageCircle, titleKey: 'landing.useCases.support', descKey: 'landing.useCases.supportDesc', color: 'text-orange-400', bg: 'bg-orange-500/10 dark:bg-orange-500/10' },
];

export function Landing() {
  const { dark, toggle } = useTheme();
  const { t } = useTranslation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className={`min-h-screen ${dark ? 'bg-[#080808]' : 'bg-[#F3EFE7]'} transition-colors duration-500`}>
      <div className="noise" />

      {/* ── Navbar ──────────────────────────────── */}
      <nav className="fixed top-0 w-full z-40 border-b border-black/5 dark:border-white/10 bg-[#F3EFE7]/90 dark:bg-[#080808]/90 backdrop-blur-md transition-colors duration-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between">
          <div className="flex gap-3 sm:gap-4 items-center cursor-pointer group">
            <Link to="/" className="font-display text-2xl sm:text-4xl leading-none text-black dark:text-white uppercase tracking-wide group-hover:scale-105 transition-transform duration-300 relative">
              Baaton
              <div className="absolute -right-2 -top-1 w-2 h-2 bg-amber-500 rounded-full" />
            </Link>

          </div>
          <div className="hidden md:flex items-center gap-8 text-sm font-semibold text-neutral-600 dark:text-neutral-400">
            <a href="#features" className="hover:text-black dark:hover:text-white transition-colors">{t('landing.nav.features')}</a>
            <a href="#how-it-works" className="hover:text-black dark:hover:text-white transition-colors">{t('landing.nav.methodology')}</a>
            <a href="#pricing" className="hover:text-black dark:hover:text-white transition-colors">{t('landing.nav.pricing')}</a>
            <Link to="/docs" className="hover:text-black dark:hover:text-white transition-colors">{t('landing.nav.docs')}</Link>
            <Link to="/docs#api-reference" className="hover:text-black dark:hover:text-white transition-colors">{t('landing.nav.api')}</Link>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <button onClick={toggle} className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-neutral-900 dark:text-white transition-colors" aria-label="Toggle theme">
              {dark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <LanguageSwitcher variant="compact" />
            <div className="h-4 w-[1px] bg-black/10 dark:bg-white/10 hidden sm:block" />
            <Link to="/sign-in" className="text-sm font-semibold text-neutral-900 dark:text-white hover:opacity-70 transition-opacity hidden sm:block">{t('landing.nav.login')}</Link>
            <Link to="/sign-up" className="hidden sm:flex px-5 py-2.5 bg-black dark:bg-white text-white dark:text-black text-sm font-bold rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all items-center gap-2 shadow-xl shadow-black/10 dark:shadow-white/5 transform hover:-translate-y-0.5">
              <span>{t('landing.cta')}</span>
              <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
            </Link>
            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-neutral-900 dark:text-white transition-colors"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
        {/* Mobile menu dropdown */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-black/5 dark:border-white/10 bg-[#F3EFE7] dark:bg-[#080808] px-4 py-4 space-y-3">
            <a href="#features" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-semibold text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white py-2">{t('landing.nav.features')}</a>
            <a href="#how-it-works" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-semibold text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white py-2">{t('landing.nav.methodology')}</a>
            <a href="#pricing" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-semibold text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white py-2">{t('landing.nav.pricing')}</a>
            <Link to="/docs" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-semibold text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white py-2">{t('landing.nav.docs')}</Link>
            <Link to="/docs#api-reference" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-semibold text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white py-2">{t('landing.nav.api')}</Link>
            <div className="border-t border-black/5 dark:border-white/10 pt-3 flex flex-col gap-2">
              <LanguageSwitcher variant="full" className="py-1" />
              <Link to="/sign-in" onClick={() => setMobileMenuOpen(false)} className="text-sm font-semibold text-neutral-900 dark:text-white py-2">{t('landing.nav.login')}</Link>
              <Link to="/sign-up" onClick={() => setMobileMenuOpen(false)} className="px-5 py-2.5 bg-black dark:bg-white text-white dark:text-black text-sm font-bold rounded-lg text-center">
                {t('landing.cta')}
              </Link>
            </div>
          </div>
        )}
      </nav>

      {/* ── Hero ────────────────────────────────── */}
      <main className="sm:pt-48 sm:pb-32 overflow-hidden pt-28 pb-16 relative">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[800px] bg-glow-light dark:bg-glow-dark opacity-100 pointer-events-none transition-opacity duration-700" />
        <div className="absolute inset-0 bg-grid-pattern-light dark:bg-grid-pattern bg-[size:4rem_4rem] opacity-[0.04] dark:opacity-[0.03] pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#F3EFE7] dark:to-[#080808] pointer-events-none" />

        <div className="max-w-7xl mx-auto px-6 text-center relative z-10 flex flex-col items-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/40 dark:bg-white/5 border border-black/5 dark:border-white/10 mb-8 backdrop-blur-sm opacity-0 animate-reveal-up shadow-sm">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-xs font-mono font-medium text-neutral-600 dark:text-neutral-400 tracking-wide uppercase">{t('landing.badge')}</span>
          </div>

          {/* Headline */}
          <h1 className="font-display text-[13vw] sm:text-[11vw] md:text-[9rem] leading-[0.8] text-black dark:text-white mb-6 sm:mb-8 opacity-0 animate-reveal-up-delay uppercase tracking-tight">
            <span className="block">{t('landing.heroLine1')}</span>
            <span className="block text-neutral-400 dark:text-neutral-500">{t('landing.heroLine2')}</span>
          </h1>

          <p className="text-xl md:text-2xl text-neutral-600 dark:text-neutral-400 max-w-2xl mx-auto leading-relaxed mb-12 opacity-0 animate-reveal-up-delay-2 font-medium">
            {t('landing.heroSub')}
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 opacity-0 animate-reveal-up-delay-3">
            <Link to="/sign-up" className="h-14 px-10 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold text-lg transition-all shadow-[0_4px_0_0_#d97706] hover:shadow-[0_2px_0_0_#d97706] hover:translate-y-[2px] active:shadow-none active:translate-y-[4px] flex items-center gap-2 w-full sm:w-auto justify-center group">
              <span className="tracking-tight">{t('landing.cta')}</span>
              <ArrowRight className="w-5 h-5" strokeWidth={2.5} />
            </Link>
            <Link to="/docs" className="h-14 px-10 rounded-lg bg-white dark:bg-neutral-900 border border-black/10 dark:border-white/10 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-black dark:text-white font-semibold transition-all flex items-center gap-2 w-full sm:w-auto justify-center text-sm shadow-[0_4px_0_0_rgba(0,0,0,0.1)] hover:shadow-[0_2px_0_0_rgba(0,0,0,0.1)] hover:translate-y-[2px] active:shadow-none active:translate-y-[4px] dark:shadow-[0_4px_0_0_rgba(255,255,255,0.1)] dark:hover:shadow-[0_2px_0_0_rgba(255,255,255,0.1)]">
              {t('landing.readDocs')}
            </Link>
          </div>

          {/* Code Snippet Tabs */}
          <CodeTabs />
        </div>

        {/* ── Kanban Mockup ──────────────────────── */}
        <div className="mt-16 sm:mt-32 max-w-6xl mx-auto px-4 perspective-container relative z-10 opacity-0 animate-fade-in-delay">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] h-[90%] bg-amber-500/10 blur-[80px] rounded-full pointer-events-none" />
          <div className="tilted-board bg-[#FAFAFA] dark:bg-[#0C0C0C] border border-black/5 dark:border-amber-500/10 rounded-xl shadow-2xl dark:shadow-[0_0_80px_-20px_rgba(245,158,11,0.15)] overflow-hidden ring-1 ring-black/5 dark:ring-amber-500/10">
            {/* Toolbar */}
            <div className="h-14 border-b border-neutral-200 dark:border-white/8 flex items-center px-5 justify-between bg-white dark:bg-[#111]">
              <div className="flex items-center gap-4">
                <div className="flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-neutral-300 dark:bg-neutral-800 border border-black/5" />
                  <div className="w-3 h-3 rounded-full bg-neutral-300 dark:bg-neutral-800 border border-black/5" />
                  <div className="w-3 h-3 rounded-full bg-neutral-300 dark:bg-neutral-800 border border-black/5" />
                </div>
                <div className="h-5 w-[1px] bg-neutral-200 dark:bg-white/10 mx-2" />
                <span className="text-xs font-bold text-neutral-900 dark:text-neutral-400 flex items-center gap-2 tracking-wide uppercase font-display">
                  <LayoutDashboard className="w-4 h-4 text-amber-500" />
                  Board / Core
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex -space-x-3 hover:space-x-1 transition-all">
                  <div className="w-8 h-8 rounded-full bg-neutral-100 dark:bg-neutral-800 border-2 border-white dark:border-[#0A0A0A] flex items-center justify-center text-[10px] font-bold text-black dark:text-white">JD</div>
                  <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/50 border-2 border-white dark:border-[#0A0A0A] flex items-center justify-center text-[10px] text-amber-600 dark:text-amber-200"><Bot className="w-4 h-4" /></div>
                </div>
                <button className="px-3 py-1.5 rounded bg-black dark:bg-white text-white dark:text-black text-xs font-bold shadow-md hover:opacity-90 transition-opacity">New Issue</button>
              </div>
            </div>

            {/* Kanban Columns */}
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-neutral-200 dark:divide-white/8 md:h-[550px] bg-[#F8F8F8] dark:bg-[#0C0C0C]">
              {/* Backlog */}
              <div className="p-5 flex flex-col gap-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-black text-black dark:text-white uppercase tracking-wider flex items-center gap-2 font-display text-lg">Backlog</h3>
                  <span className="px-2 py-0.5 rounded bg-neutral-200 dark:bg-neutral-800 text-[10px] text-black dark:text-white font-mono font-bold">3</span>
                </div>
                <KanbanCard id="BAT-129" title="Implement OAuth flow for GitHub provider" tag="Auth" />
                <KanbanCard id="BAT-130" title="Update landing page assets" tag="Design" />
              </div>

              {/* AI Active */}
              <div className="p-5 flex flex-col gap-4 bg-amber-50/50 dark:bg-neutral-900/20 relative">
                <div className="flex items-center justify-between mb-2 relative z-10">
                  <h3 className="text-xs font-black text-amber-600 dark:text-amber-500 uppercase tracking-wider flex items-center gap-2 font-display text-lg">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                    </span>
                    AI Active
                  </h3>
                  <span className="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/50 text-[10px] text-amber-700 dark:text-amber-500 font-mono font-bold">1</span>
                </div>
                <div className="p-4 rounded-lg border-2 border-amber-500 dark:border-amber-500/50 bg-white dark:bg-[#15120b] shadow-[0_8px_30px_-5px_rgba(245,158,11,0.15)] relative overflow-hidden z-10">
                  <div className="flex justify-between items-start mb-3">
                    <span className="text-[10px] text-amber-600 dark:text-amber-500/70 font-mono font-bold">BAT-124</span>
                    <span className="text-[10px] text-amber-600 dark:text-amber-500 font-mono font-bold animate-pulse flex items-center gap-1">
                      <Loader className="w-3 h-3 animate-spin" /> GENERATING
                    </span>
                  </div>
                  <p className="text-sm text-black dark:text-white mb-4 font-bold leading-snug">Refactor database schema for scalability</p>
                  <div className="p-3 mb-4 bg-neutral-900 dark:bg-black/60 rounded border border-neutral-800 dark:border-white/5 font-mono text-[10px] text-neutral-300 dark:text-neutral-400 leading-relaxed">
                    <div className="flex gap-2"><span className="text-green-500 font-bold">➜</span> reading issue context...</div>
                    <div className="flex gap-2"><span className="text-green-500 font-bold">➜</span> updating status: in_progress</div>
                    <div className="flex gap-2"><span className="text-neutral-500">...</span> posting TLDR summary</div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-1 rounded bg-amber-100 dark:bg-amber-950/30 text-[10px] font-bold text-amber-700 dark:text-amber-500 uppercase tracking-tight">Backend</span>
                    <div className="w-6 h-6 rounded-full bg-amber-500 flex items-center justify-center text-white dark:text-black shadow-lg shadow-amber-500/30">
                      <Bot className="w-3.5 h-3.5" strokeWidth={2.5} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Review */}
              <div className="p-5 flex flex-col gap-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-black text-black dark:text-white uppercase tracking-wider flex items-center gap-2 font-display text-lg">Review</h3>
                  <span className="px-2 py-0.5 rounded bg-neutral-200 dark:bg-neutral-800 text-[10px] text-black dark:text-white font-mono font-bold">2</span>
                </div>
                <div className="group p-4 rounded-lg border border-black/5 dark:border-white/5 bg-white dark:bg-[#111] shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] hover:shadow-md transition-all cursor-pointer opacity-70 hover:opacity-100">
                  <div className="flex justify-between items-start mb-3">
                    <span className="text-[10px] text-neutral-400 font-mono font-bold">BAT-112</span>
                    <div className="px-2 py-0.5 rounded bg-green-100 dark:bg-green-900/20 text-[10px] font-bold text-green-700 dark:text-green-500 border border-green-200 dark:border-green-500/20 font-mono uppercase">PR Ready</div>
                  </div>
                  <p className="text-sm text-neutral-500 dark:text-neutral-500 mb-4 font-medium line-through">Fix navigation z-index bug</p>
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-1 rounded bg-neutral-100 dark:bg-neutral-800 text-[10px] font-bold text-neutral-600 dark:text-neutral-400 uppercase tracking-tight">Bug</span>
                    <div className="w-6 h-6 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
                      <Check className="w-3.5 h-3.5 text-green-600" strokeWidth={3} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ── Features ───────────────────────────── */}
      <section id="features" className="py-16 sm:py-32 border-t border-black/5 dark:border-white/5 bg-white dark:bg-[#080808] transition-colors relative z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="mb-12 sm:mb-20 md:text-center max-w-3xl mx-auto">
            <h2 className="font-display text-4xl sm:text-5xl md:text-7xl text-black dark:text-white mb-6 uppercase tracking-tight">{t('landing.features.title1')}<br />{t('landing.features.title2')}</h2>
            <p className="text-xl text-neutral-600 dark:text-neutral-400 font-medium">{t('landing.features.sub')}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <FeatureCard icon={<Inbox className="w-6 h-6 text-black dark:text-white" strokeWidth={2} />} title={t('landing.features.collect')} desc={t('landing.features.collectDesc')} />
            <FeatureCard icon={<Cpu className="w-6 h-6 text-black dark:text-white" strokeWidth={2} />} title={t('landing.features.api')} desc={t('landing.features.apiDesc')} glow />
            <FeatureCard icon={<Gavel className="w-6 h-6 text-black dark:text-white" strokeWidth={2} />} title={t('landing.features.human')} desc={t('landing.features.humanDesc')} />
          </div>
        </div>
      </section>

      {/* ── Workflow ────────────────────────────── */}
      <section className="py-16 sm:py-32 bg-[#F3EFE7] dark:bg-[#080808] transition-colors relative z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-10 md:gap-16">
            <div className="md:w-1/2">
              <h2 className="font-display text-4xl sm:text-5xl md:text-7xl text-black dark:text-white mb-8 md:mb-10 uppercase tracking-tight">{t('landing.workflow.title1')}<br />{t('landing.workflow.title2')}</h2>
              <ul className="space-y-10 relative">
                <div className="absolute top-4 bottom-4 left-4 w-[2px] bg-black/5 dark:bg-white/10 -z-10" />
                <Step n="1" title={t('landing.workflow.step1')} desc={t('landing.workflow.step1Desc')} />
                <Step n="2" title={t('landing.workflow.step2')} desc={t('landing.workflow.step2Desc')} active />
                <Step n="3" title={t('landing.workflow.step3')} desc={t('landing.workflow.step3Desc')} />
              </ul>
            </div>
            <div className="md:w-1/2 w-full">
              <div className="rounded-xl border border-black/10 dark:border-white/10 bg-[#1a1a1a] dark:bg-[#0A0A0A] p-6 font-mono text-sm shadow-2xl relative overflow-hidden">
                <div className="flex items-center gap-2 mb-6 border-b border-white/10 pb-4">
                  <div className="w-3 h-3 rounded-full bg-[#FF5F56]" />
                  <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
                  <div className="w-3 h-3 rounded-full bg-[#27C93F]" />
                  <span className="ml-4 text-neutral-500 text-xs">agent-logs.txt</span>
                </div>
                <div className="space-y-3 text-xs md:text-sm">
                  <LogLine time="10:42:01" level="INFO" color="text-blue-400" text="Agent read issue BAT-124 context" dim />
                  <LogLine time="10:42:05" level="INFO" color="text-blue-400" text="Status → in_progress" />
                  <LogLine time="10:42:23" level="INFO" color="text-green-400" text="TLDR posted: 3 files changed, tests passed" />
                  <div className="flex gap-3 mt-4 p-3 bg-white/5 rounded border-l-2 border-amber-500 animate-pulse">
                    <span className="text-neutral-500">10:43:45</span>
                    <span className="text-purple-400 font-bold">PATCH</span>
                    <span className="text-white font-bold">Status → in_review. Waiting for approval.</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Use Cases ──────────────────────────── */}
      <section className="py-16 sm:py-32 border-t border-black/5 dark:border-white/5 bg-[#F3EFE7] dark:bg-[#080808] transition-colors relative z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="mb-12 sm:mb-16 max-w-3xl">
            <p className="text-xs font-bold text-amber-500 uppercase tracking-widest mb-3">{t('landing.useCases.badge')}</p>
            <h2 className="font-display text-4xl sm:text-5xl md:text-7xl text-black dark:text-white mb-6 uppercase tracking-tight">{t('landing.useCases.title1')}<br />{t('landing.useCases.title2')}</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {useCasesConfig.map((uc) => (
              <div key={uc.titleKey} className="p-8 rounded-xl border border-black/5 dark:border-white/5 bg-white dark:bg-neutral-900/20 hover:shadow-xl transition-all group">
                <div className={`w-12 h-12 rounded-lg ${uc.bg} flex items-center justify-center mb-6`}>
                  <uc.icon className={`w-6 h-6 ${uc.color}`} strokeWidth={1.5} />
                </div>
                <h3 className="text-xl font-display uppercase tracking-wide text-black dark:text-white mb-3">{t(uc.titleKey)}</h3>
                <p className="text-base text-neutral-600 dark:text-neutral-400 leading-relaxed font-medium">{t(uc.descKey)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stats ──────────────────────────────── */}
      <section className="py-12 sm:py-20 border-t border-black/5 dark:border-white/5 bg-white dark:bg-[#060606] transition-colors relative z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { valueKey: 'landing.stats.apiFirst', labelKey: 'landing.stats.apiFirstLabel' },
            { valueKey: 'landing.stats.webhooks', labelKey: 'landing.stats.webhooksLabel' },
            { valueKey: 'landing.stats.latency', labelKey: 'landing.stats.latencyLabel' },
            { valueKey: 'landing.stats.endpoints', labelKey: 'landing.stats.endpointsLabel' },
          ].map((stat) => (
            <div key={stat.labelKey}>
              <div className="text-3xl md:text-4xl font-display font-bold text-black dark:text-white mb-2 uppercase">{t(stat.valueKey)}</div>
              <div className="text-sm text-neutral-500 font-medium">{t(stat.labelKey)}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Pricing ────────────────────────────── */}
      <section id="pricing" className="py-16 sm:py-32 border-t border-black/5 dark:border-white/5 bg-white dark:bg-[#080808] transition-colors relative z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="mb-12 sm:mb-16 text-center max-w-3xl mx-auto">
            <p className="text-xs font-bold text-amber-500 uppercase tracking-widest mb-3">{t('landing.pricing.badge')}</p>
            <h2 className="font-display text-4xl sm:text-5xl md:text-7xl text-black dark:text-white mb-6 uppercase tracking-tight">{t('landing.pricing.title1')}<br />{t('landing.pricing.title2')}</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Free */}
            <div className="p-8 rounded-xl border border-black/5 dark:border-white/5 bg-neutral-50 dark:bg-neutral-900/20 hover:shadow-xl transition-all flex flex-col">
              <h3 className="text-lg font-display uppercase tracking-wide text-black dark:text-white mb-2">{t('landing.pricing.free')}</h3>
              <div className="flex items-baseline gap-1 mb-2">
                <span className="text-4xl font-display font-bold text-black dark:text-white">{t('landing.pricing.freePrice')}</span>
                <span className="text-sm text-neutral-500">{t('landing.pricing.freePeriod')}</span>
              </div>
              <p className="text-sm text-neutral-500 mb-6">{t('landing.pricing.freeDesc')}</p>
              <ul className="space-y-3 mb-8 flex-1">
                {['freeF1', 'freeF2', 'freeF3', 'freeF4'].map(k => (
                  <li key={k} className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                    <Check className="w-4 h-4 text-green-500 flex-shrink-0" /> {t(`landing.pricing.${k}`)}
                  </li>
                ))}
              </ul>
              <Link to="/sign-up" className="w-full py-3 rounded-lg border border-black/10 dark:border-white/10 text-center text-sm font-bold text-black dark:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">
                {t('landing.pricing.freeCta')}
              </Link>
            </div>
            {/* Pro — highlighted */}
            <div className="p-8 rounded-xl border-2 border-amber-500 bg-white dark:bg-[#111] shadow-xl shadow-amber-500/10 hover:shadow-2xl transition-all flex flex-col relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-amber-500 text-black text-xs font-bold uppercase tracking-wider">Popular</div>
              <h3 className="text-lg font-display uppercase tracking-wide text-black dark:text-white mb-2">{t('landing.pricing.pro')}</h3>
              <div className="flex items-baseline gap-1 mb-2">
                <span className="text-4xl font-display font-bold text-black dark:text-white">{t('landing.pricing.proPrice')}</span>
                <span className="text-sm text-neutral-500">{t('landing.pricing.proPeriod')}</span>
              </div>
              <p className="text-sm text-neutral-500 mb-6">{t('landing.pricing.proDesc')}</p>
              <ul className="space-y-3 mb-8 flex-1">
                {['proF1', 'proF2', 'proF3', 'proF4', 'proF5'].map(k => (
                  <li key={k} className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                    <Check className="w-4 h-4 text-amber-500 flex-shrink-0" /> {t(`landing.pricing.${k}`)}
                  </li>
                ))}
              </ul>
              <Link to="/sign-up" className="w-full py-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-center text-sm font-bold text-black transition-colors shadow-lg shadow-amber-500/20">
                {t('landing.pricing.proCta')}
              </Link>
            </div>
            {/* Enterprise */}
            <div className="p-8 rounded-xl border border-black/5 dark:border-white/5 bg-neutral-50 dark:bg-neutral-900/20 hover:shadow-xl transition-all flex flex-col">
              <h3 className="text-lg font-display uppercase tracking-wide text-black dark:text-white mb-2">{t('landing.pricing.enterprise')}</h3>
              <div className="flex items-baseline gap-1 mb-2">
                <span className="text-4xl font-display font-bold text-black dark:text-white">{t('landing.pricing.enterprisePrice')}</span>
                {t('landing.pricing.enterprisePeriod') && <span className="text-sm text-neutral-500">{t('landing.pricing.enterprisePeriod')}</span>}
              </div>
              <p className="text-sm text-neutral-500 mb-6">{t('landing.pricing.enterpriseDesc')}</p>
              <ul className="space-y-3 mb-8 flex-1">
                {['enterpriseF1', 'enterpriseF2', 'enterpriseF3', 'enterpriseF4', 'enterpriseF5'].map(k => (
                  <li key={k} className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                    <Check className="w-4 h-4 text-green-500 flex-shrink-0" /> {t(`landing.pricing.${k}`)}
                  </li>
                ))}
              </ul>
              <a href="mailto:thibaut@carbonable.io" className="w-full py-3 rounded-lg border border-black/10 dark:border-white/10 text-center text-sm font-bold text-black dark:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">
                {t('landing.pricing.enterpriseCta')}
              </a>
            </div>
          </div>
          <p className="text-center text-sm text-neutral-500 mt-8">{t('landing.readDocs')} → <Link to="/docs" className="text-amber-500 hover:underline">{t('landing.nav.docs')}</Link></p>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────── */}
      <section className="py-16 sm:py-32 border-t border-black/5 dark:border-white/5 relative overflow-hidden bg-white dark:bg-[#050505] transition-colors z-20">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-amber-500/5 blur-[120px] rounded-full pointer-events-none" />
        <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center relative z-10">
          <h2 className="font-display text-[10vw] sm:text-8xl font-black text-black dark:text-white tracking-tight mb-8 leading-[0.8] uppercase">
            {t('landing.ctaTitle1')}<br />{t('landing.ctaTitle2')}
          </h2>
          <p className="text-xl text-neutral-600 dark:text-neutral-400 mb-12 max-w-2xl mx-auto font-medium">
            {t('landing.ctaSub')}
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
            <Link to="/sign-up" className="h-14 px-10 rounded-lg bg-black dark:bg-white text-white dark:text-black text-lg font-bold hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors flex items-center gap-2 w-full sm:w-auto justify-center shadow-xl transform hover:-translate-y-1">
              {t('landing.cta')} <ArrowRight className="w-5 h-5" strokeWidth={2} />
            </Link>
            <Link to="/docs" className="h-14 px-10 rounded-lg border border-black/10 dark:border-white/10 text-black dark:text-white text-lg font-bold hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors flex items-center gap-2 w-full sm:w-auto justify-center">
              {t('landing.nav.docs')}
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────── */}
      <footer className="py-12 border-t border-black/5 dark:border-white/5 bg-[#F3EFE7] dark:bg-[#080808] text-sm transition-colors z-20">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
          <Link to="/" className="font-display text-2xl text-black dark:text-white uppercase tracking-wide">Baaton</Link>
          <div className="flex gap-8 text-neutral-600 dark:text-neutral-500 font-bold uppercase tracking-wider text-xs">
            <Link to="/docs" className="hover:text-black dark:hover:text-white transition-colors">{t('landing.nav.docs')}</Link>
            <Link to="/docs#api-reference" className="hover:text-black dark:hover:text-white transition-colors">{t('landing.nav.api')}</Link>
            <a href="https://github.com/rmzlb/baaton" target="_blank" rel="noopener noreferrer" className="hover:text-black dark:hover:text-white transition-colors">GitHub</a>
            <a href="https://x.com/baaboron" target="_blank" rel="noopener noreferrer" className="hover:text-black dark:hover:text-white transition-colors">Twitter</a>
          </div>
          <div className="text-neutral-500 font-medium">© 2026 Baaton Inc.</div>
        </div>
      </footer>
    </div>
  );
}

/* ── Sub-components ──────────────────────────── */

function KanbanCard({ id, title, tag }: { id: string; title: string; tag: string }) {
  return (
    <div className="group p-4 rounded-lg border border-black/5 dark:border-white/10 bg-white dark:bg-[#151515] shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] hover:shadow-md hover:border-black/10 dark:hover:border-white/15 transition-all cursor-pointer">
      <div className="flex justify-between items-start mb-3">
        <span className="text-[10px] text-neutral-400 font-mono font-bold">{id}</span>
        <MoreHorizontal className="w-4 h-4 text-neutral-400 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <p className="text-sm text-black dark:text-neutral-200 mb-4 font-semibold leading-snug">{title}</p>
      <div className="flex items-center justify-between">
        <span className="px-2 py-1 rounded bg-neutral-100 dark:bg-neutral-800 text-[10px] font-bold text-neutral-600 dark:text-neutral-400 uppercase tracking-tight">{tag}</span>
        <div className="w-6 h-6 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
          <User className="w-3.5 h-3.5 text-neutral-500" />
        </div>
      </div>
    </div>
  );
}

function FeatureCard({ icon, title, desc, glow }: { icon: React.ReactNode; title: string; desc: string; glow?: boolean }) {
  return (
    <div className="p-8 rounded-xl border border-black/5 dark:border-white/5 bg-neutral-50 dark:bg-neutral-900/20 hover:bg-white dark:hover:bg-neutral-900/40 hover:shadow-xl dark:hover:shadow-none transition-all group relative overflow-hidden">
      {glow && <div className="absolute -right-12 -top-12 w-40 h-40 bg-amber-500/10 rounded-full blur-3xl group-hover:bg-amber-500/20 transition-colors" />}
      <div className="w-12 h-12 rounded-lg bg-white dark:bg-neutral-800 flex items-center justify-center mb-8 border border-black/5 dark:border-white/5 shadow-sm">
        {icon}
      </div>
      <h3 className="text-2xl font-display uppercase tracking-wide text-black dark:text-white mb-4">{title}</h3>
      <p className="text-base text-neutral-600 dark:text-neutral-400 leading-relaxed font-medium">{desc}</p>
    </div>
  );
}

function Step({ n, title, desc, active }: { n: string; title: string; desc: string; active?: boolean }) {
  return (
    <li className="flex gap-8">
      <span className={`flex-shrink-0 w-8 h-8 rounded text-sm font-mono font-bold flex items-center justify-center z-10 ${
        active
          ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/30 transform scale-110'
          : 'bg-white dark:bg-neutral-800 border border-black/10 dark:border-white/10 text-black dark:text-white shadow-sm'
      }`}>{n}</span>
      <div>
        <h4 className="text-xl font-bold text-black dark:text-white mb-2 font-display uppercase tracking-wide">{title}</h4>
        <p className="text-neutral-600 dark:text-neutral-500 font-medium leading-relaxed">{desc}</p>
      </div>
    </li>
  );
}

function LogLine({ time, level, color, text, dim }: { time: string; level: string; color: string; text: string; dim?: boolean }) {
  return (
    <div className={`flex gap-3 ${dim ? 'opacity-50' : 'opacity-75'}`}>
      <span className="text-neutral-500">{time}</span>
      <span className={`${color} font-bold`}>{level}</span>
      <span className="text-neutral-300">{text}</span>
    </div>
  );
}

export default Landing;
