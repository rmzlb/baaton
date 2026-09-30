import { useRef, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Sun, Moon, Bot, User, Check,
  Inbox, Cpu, Copy, Menu, X, Rocket, Users, Layers,
  MessageCircle, KeyRound, ArrowLeftRight, ListChecks, FileCheck2, Workflow,
  MousePointerClick, Terminal, Quote,
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useLandingTheme } from '@/hooks/useLandingTheme';
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { HeroFlow, LiveBoard, AgentTerminal } from '@/components/landing/Flow';

/* ─── Code Tabs Component ──────────────────── */
const codeSnippets: Record<string, string> = {
  cURL: `curl -X POST https://api.baaton.dev/api/v1/issues \\
  -H "Authorization: Bearer ***" \\
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
    headers={"Authorization": "Bearer ***"},
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
      "Authorization": "Bearer ***",
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

/* ─── "Hand it to your agent" one-liner ────── */
function AgentPrompt() {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const prompt = t('landing.start.agentPrompt');
  const handleCopy = () => {
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="rounded-lg bg-[#1a1a1a] dark:bg-black border border-black/10 dark:border-white/10 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">{t('landing.start.agentPromptLabel')}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-neutral-400 hover:text-white active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition-[transform,colors] duration-150"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? t('landing.start.copied') : t('landing.start.copy')}
        </button>
      </div>
      <p className="px-3 py-3 font-mono text-[12.5px] leading-relaxed text-emerald-300/90 break-words">{prompt}</p>
    </div>
  );
}

/* ─── Section data ─────────────────────────── */
const useCasesConfig = [
  { icon: Rocket, titleKey: 'landing.useCases.coding', descKey: 'landing.useCases.codingDesc', color: 'text-blue-400', bg: 'bg-blue-500/10 dark:bg-blue-500/10' },
  { icon: Users, titleKey: 'landing.useCases.qa', descKey: 'landing.useCases.qaDesc', color: 'text-green-400', bg: 'bg-green-500/10 dark:bg-green-500/10' },
  { icon: Layers, titleKey: 'landing.useCases.devops', descKey: 'landing.useCases.devopsDesc', color: 'text-purple-400', bg: 'bg-purple-500/10 dark:bg-purple-500/10' },
  { icon: MessageCircle, titleKey: 'landing.useCases.support', descKey: 'landing.useCases.supportDesc', color: 'text-orange-400', bg: 'bg-orange-500/10 dark:bg-orange-500/10' },
];

const featuresConfig = [
  { icon: Inbox, titleKey: 'landing.features.collect', descKey: 'landing.features.collectDesc' },
  { icon: Cpu, titleKey: 'landing.features.api', descKey: 'landing.features.apiDesc', glow: true },
  { icon: ListChecks, titleKey: 'landing.features.status', descKey: 'landing.features.statusDesc' },
  { icon: FileCheck2, titleKey: 'landing.features.proof', descKey: 'landing.features.proofDesc', glow: true },
  { icon: Layers, titleKey: 'landing.features.multi', descKey: 'landing.features.multiDesc' },
  { icon: Workflow, titleKey: 'landing.features.automations', descKey: 'landing.features.automationsDesc', glow: true },
];

const navLinks = [
  { href: '#how-it-works', key: 'landing.nav.features' },
  { href: '#pricing', key: 'landing.nav.pricing' },
];

export function Landing() {
  const { dark, toggle } = useLandingTheme();
  const { t, i18n } = useTranslation();
  const demoLang = i18n.language?.startsWith('en') ? 'en' : 'fr';
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className={`min-h-screen ${dark ? 'bg-[#080808]' : 'bg-[#F3EFE7]'} transition-colors duration-500`}>
      <div className="noise" />

      {/* ── Navbar ──────────────────────────────── */}
      <nav className="fixed top-0 w-full z-40 border-b border-black/5 dark:border-white/10 bg-[#F3EFE7]/90 dark:bg-[#080808]/90 backdrop-blur-md transition-colors duration-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 sm:gap-3 group" aria-label="Baaton">
            <img src="/favicon.svg" alt="" className="w-7 h-7 sm:w-9 sm:h-9 [image-rendering:pixelated]" />
            <span className="font-display text-2xl sm:text-4xl leading-none text-black dark:text-white uppercase tracking-wide group-hover:scale-105 transition-transform duration-300 relative">
              Baaton
              <span className="absolute -right-2 -top-1 w-2 h-2 bg-amber-500 rounded-full" />
            </span>
          </Link>
          <div className="hidden md:flex items-center gap-8 text-sm font-semibold text-neutral-600 dark:text-neutral-400">
            {navLinks.map((l) => (
              <a key={l.href} href={l.href} className="hover:text-black dark:hover:text-white transition-colors">{t(l.key)}</a>
            ))}
            <Link to="/compare" className="hover:text-black dark:hover:text-white transition-colors">{t('landing.nav.methodology')}</Link>
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
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-neutral-900 dark:text-white transition-colors"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-black/5 dark:border-white/10 bg-[#F3EFE7] dark:bg-[#080808] px-4 py-4 space-y-3">
            {navLinks.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setMobileMenuOpen(false)} className="block text-sm font-semibold text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white py-2">{t(l.key)}</a>
            ))}
            <Link to="/compare" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-semibold text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white py-2">{t('landing.nav.methodology')}</Link>
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

      {/* ══ 01 — Hero: the promise, then one request through the real statuses ══ */}
      <main className="pt-24 sm:pt-32 pb-16 sm:pb-24 overflow-hidden relative">
        <HeroFlow />
      </main>

      {/* ══ 02 — The pain, right after the promise ══ */}
      <section id="problem" className="py-16 sm:py-28 border-t border-black/5 dark:border-white/5 bg-white dark:bg-[#060606] transition-colors relative z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl mb-10">
            <p className="text-xs font-bold text-amber-500 uppercase tracking-widest mb-3">{t('landing.gap.badge')}</p>
            <h2 className="font-display text-3xl sm:text-4xl md:text-5xl text-black dark:text-white uppercase tracking-tight mb-4">{t('landing.gap.title')}</h2>
            <p className="text-lg text-neutral-600 dark:text-neutral-400 font-medium">{t('landing.gap.sub')}</p>
          </div>
          <div className="border border-black/10 dark:border-white/10 rounded-xl overflow-hidden bg-white dark:bg-[#0C0C0C]">
            <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-black/10 dark:divide-white/10 bg-neutral-50 dark:bg-neutral-900/40">
              <div className="px-5 py-3 font-mono text-[11px] uppercase tracking-widest text-neutral-500">{t('landing.gap.leftHead')}</div>
              <div className="px-5 py-3 font-mono text-[11px] uppercase tracking-widest text-neutral-500">{t('landing.gap.rightHead')}</div>
            </div>
            {[['landing.gap.l1', 'landing.gap.r1'], ['landing.gap.l2', 'landing.gap.r2'], ['landing.gap.l3', 'landing.gap.r3']].map(([l, r]) => (
              <div key={l} className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-black/10 dark:divide-white/10 border-t border-black/10 dark:border-white/10">
                <div className="px-5 py-5 text-[15px] text-black dark:text-white leading-relaxed">{t(l)}</div>
                <div className="px-5 py-5 text-[15px] text-neutral-400 dark:text-neutral-500 leading-relaxed font-medium">{t(r)}</div>
              </div>
            ))}
          </div>
          <p className="mt-5 text-sm text-neutral-500">{t('landing.gap.note')}</p>
        </div>
      </section>

      {/* ══ 03 — Why: the conviction, three principles, the founder ══ */}
      <section id="why" className="py-16 sm:py-28 border-t border-black/5 dark:border-white/5 bg-[#F3EFE7] dark:bg-[#080808] transition-colors relative z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl mb-12">
            <p className="text-xs font-bold text-amber-500 uppercase tracking-widest mb-3">{t('landing.manifesto.title')}</p>
            <h2 className="font-display text-3xl sm:text-4xl md:text-5xl text-black dark:text-white uppercase tracking-tight mb-6">{t('landing.why.title')}</h2>
            <p className="text-lg text-neutral-600 dark:text-neutral-400 font-medium leading-relaxed">{t('landing.manifesto.body')}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-black/10 dark:bg-white/10 border border-black/10 dark:border-white/10 rounded-xl overflow-hidden mb-12">
            {(['p1', 'p2', 'p3'] as const).map((p, i) => (
              <div key={p} className="bg-white dark:bg-[#0C0C0C] p-6 sm:p-8">
                <span className="font-mono text-xs font-bold text-amber-600 dark:text-amber-500 tabular-nums">0{i + 1}</span>
                <h3 className="mt-3 text-xl font-display uppercase tracking-wide text-black dark:text-white mb-3">{t(`landing.why.${p}`)}</h3>
                <p className="text-[15px] text-neutral-600 dark:text-neutral-400 leading-relaxed font-medium">{t(`landing.why.${p}Desc`)}</p>
              </div>
            ))}
          </div>
          <figure className="max-w-3xl">
            <Quote className="w-6 h-6 text-amber-500 mb-4" />
            <blockquote className="text-xl sm:text-2xl text-black dark:text-white leading-[1.45] font-medium border-l-2 border-amber-500 pl-6">
              {t('landing.why.quote')}
            </blockquote>
            <figcaption className="mt-5 pl-6 text-sm text-neutral-500 font-mono">{t('landing.why.quoteSign')}</figcaption>
          </figure>
        </div>
      </section>

      {/* ══ 04 — Start: three ways in, before any feature list ══ */}
      <section id="start" className="scroll-mt-24 py-16 sm:py-28 border-t border-black/5 dark:border-white/5 bg-white dark:bg-[#060606] transition-colors relative z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl mb-12">
            <p className="text-xs font-bold text-amber-500 uppercase tracking-widest mb-3">{t('landing.start.badge')}</p>
            <h2 className="font-display text-3xl sm:text-4xl md:text-5xl text-black dark:text-white uppercase tracking-tight mb-4">{t('landing.start.title')}</h2>
            <p className="text-lg text-neutral-600 dark:text-neutral-400 font-medium">{t('landing.start.sub')}</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* 1 — interface */}
            <div className="p-6 sm:p-8 rounded-xl border border-black/10 dark:border-white/10 bg-neutral-50 dark:bg-neutral-900/20 flex flex-col">
              <MousePointerClick className="w-6 h-6 text-black dark:text-white mb-6" strokeWidth={1.75} />
              <h3 className="text-xl font-display uppercase tracking-wide text-black dark:text-white mb-3">{t('landing.start.ui')}</h3>
              <p className="text-[15px] text-neutral-600 dark:text-neutral-400 leading-relaxed font-medium mb-8 flex-1">{t('landing.start.uiDesc')}</p>
              <Link to="/sign-up" className="h-11 px-5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition-[transform,colors] duration-150">
                {t('landing.cta')} <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
              </Link>
            </div>
            {/* 2 — agent */}
            <div className="p-6 sm:p-8 rounded-xl border-2 border-amber-500/70 bg-white dark:bg-[#111] flex flex-col shadow-xl shadow-amber-500/5">
              <Terminal className="w-6 h-6 text-amber-600 dark:text-amber-500 mb-6" strokeWidth={1.75} />
              <h3 className="text-xl font-display uppercase tracking-wide text-black dark:text-white mb-3">{t('landing.start.agent')}</h3>
              <p className="text-[15px] text-neutral-600 dark:text-neutral-400 leading-relaxed font-medium mb-6">{t('landing.start.agentDesc')}</p>
              <AgentPrompt />
              <p className="mt-4 text-xs text-neutral-500 leading-relaxed">{t('landing.start.agentNote')}</p>
            </div>
            {/* 3 — API / self-host */}
            <div className="p-6 sm:p-8 rounded-xl border border-black/10 dark:border-white/10 bg-neutral-50 dark:bg-neutral-900/20 flex flex-col">
              <Cpu className="w-6 h-6 text-black dark:text-white mb-6" strokeWidth={1.75} />
              <h3 className="text-xl font-display uppercase tracking-wide text-black dark:text-white mb-3">{t('landing.start.api')}</h3>
              <p className="text-[15px] text-neutral-600 dark:text-neutral-400 leading-relaxed font-medium mb-8 flex-1">{t('landing.start.apiDesc')}</p>
              <div className="grid grid-cols-2 gap-3">
                <Link to="/docs#api-reference" className="h-11 px-4 rounded-lg border border-black/10 dark:border-white/10 text-sm font-bold text-black dark:text-white hover:bg-white dark:hover:bg-neutral-800 flex items-center justify-center active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition-[transform,colors] duration-150">
                  {t('landing.nav.api')}
                </Link>
                <a href="https://github.com/rmzlb/baaton" target="_blank" rel="noopener noreferrer" className="h-11 px-4 rounded-lg border border-black/10 dark:border-white/10 text-sm font-bold text-black dark:text-white hover:bg-white dark:hover:bg-neutral-800 flex items-center justify-center active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition-[transform,colors] duration-150">
                  GitHub
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══ 05 — Every open ticket, the agent at work, then the real recordings ══ */}
      <section id="how-it-works" className="scroll-mt-24 py-16 sm:py-28 bg-[#F3EFE7] dark:bg-[#080808] border-t border-black/5 dark:border-white/5 transition-colors relative z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 mb-20 sm:mb-28">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-black dark:text-white text-center mb-6">{t('landing.film.title')}</h2>
          <div className="rounded-xl border border-black/10 dark:border-white/10 overflow-hidden shadow-2xl shadow-black/20 bg-black">
            <video className="w-full block aspect-video" controls preload="none" playsInline poster="/film/baaton-film.jpg" aria-label={t('landing.film.alt')}>
              <source src="/film/baaton-film.mp4" type="video/mp4" />
            </video>
          </div>
          <p className="mt-4 text-sm text-neutral-500 text-center max-w-2xl mx-auto">{t('landing.film.note')}</p>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <LiveBoard />
          <div className="mt-20 sm:mt-28"><AgentTerminal /></div>
        </div>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 mt-20 sm:mt-28">
          <div className="rounded-xl border border-black/10 dark:border-white/10 overflow-hidden shadow-2xl shadow-black/20 mb-8">
            <video key={demoLang} className="w-full block" autoPlay muted loop playsInline preload="metadata" poster={`/demo-${demoLang}.jpg`} aria-label={t('landing.mock.demoAlt')}>
              <source src={`/demo-${demoLang}.mp4`} type="video/mp4" />
            </video>
          </div>
          <div className="rounded-xl border border-black/10 dark:border-white/10 overflow-hidden shadow-2xl shadow-black/20 mt-8">
            <img src="/agent-demo.png" alt={t('landing.mock.agentDemoAlt')} className="w-full" loading="lazy" />
          </div>
          <p className="mt-6 text-sm text-neutral-500 text-center max-w-2xl mx-auto">{t('landing.demo.note')}</p>
          <details className="group mt-4">
            <summary className="cursor-pointer text-sm text-neutral-500 hover:text-neutral-300 transition-colors flex items-center gap-2 justify-center py-4">
              <span>{t('landing.demo.raw')}</span>
              <svg className="w-4 h-4 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </summary>
            <ApiDemo />
            <CodeTabs />
          </details>
        </div>
      </section>

      {/* ══ 06 — What the agents do in it ══ */}
      <section id="features" className="py-16 sm:py-32 border-t border-black/5 dark:border-white/5 bg-white dark:bg-[#060606] transition-colors relative z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="mb-12 sm:mb-20 md:text-center max-w-3xl mx-auto">
            <p className="text-xs font-bold text-amber-500 uppercase tracking-widest mb-3">{t('landing.features.badge')}</p>
            <h2 className="font-display text-4xl sm:text-5xl md:text-7xl text-black dark:text-white mb-6 uppercase tracking-tight">{t('landing.features.title1')}<br />{t('landing.features.title2')}</h2>
            <p className="text-xl text-neutral-600 dark:text-neutral-400 font-medium">{t('landing.features.sub')}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {featuresConfig.map((f) => (
              <FeatureCard
                key={f.titleKey}
                icon={<f.icon className="w-6 h-6 text-black dark:text-white" strokeWidth={2} />}
                title={t(f.titleKey)}
                desc={t(f.descKey)}
                glow={f.glow}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ══ 07 — Who it is for, by profile ══ */}
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

      {/* ══ 08 — Proof: our own board, told as a story ══ */}
      <section id="proof" className="py-16 sm:py-28 border-t border-black/5 dark:border-white/5 bg-white dark:bg-[#060606] transition-colors relative z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl mb-12">
            <p className="text-xs font-bold text-amber-500 uppercase tracking-widest mb-3">{t('landing.counter.badge')}</p>
            <h2 className="font-display text-3xl sm:text-4xl md:text-5xl text-black dark:text-white uppercase tracking-tight mb-4">{t('landing.counter.title')}</h2>
            <p className="text-lg text-neutral-600 dark:text-neutral-400 font-medium">{t('landing.counter.sub')}</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-black/10 dark:bg-white/10 border border-black/10 dark:border-white/10 rounded-xl overflow-hidden">
            {[
              { v: 'landing.counter.n1', l: 'landing.counter.n1Label', hi: true },
              { v: 'landing.counter.n2', l: 'landing.counter.n2Label', hi: false },
              { v: 'landing.counter.n3', l: 'landing.counter.n3Label', hi: true },
              { v: 'landing.counter.n4', l: 'landing.counter.n4Label', hi: false },
            ].map((s) => (
              <div key={s.v} className="bg-white dark:bg-[#0C0C0C] p-6 sm:p-8">
                <div className={`font-mono text-3xl md:text-4xl font-bold mb-3 tracking-tight tabular-nums ${s.hi ? 'text-amber-600 dark:text-amber-500' : 'text-black dark:text-white'}`}>{t(s.v)}</div>
                <div className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed font-medium">{t(s.l)}</div>
              </div>
            ))}
          </div>

          <div className="mt-16 grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div>
              <h3 className="font-display text-2xl sm:text-3xl text-black dark:text-white uppercase tracking-tight mb-5">{t('landing.attrib.title')}</h3>
              <p className="text-lg text-neutral-600 dark:text-neutral-400 font-medium mb-8">{t('landing.attrib.sub')}</p>
              <div className="flex flex-wrap gap-8">
                <div>
                  <div className="font-mono text-3xl font-bold text-black dark:text-white mb-1 tabular-nums">{t('landing.attrib.p1')}</div>
                  <div className="text-sm text-neutral-500 max-w-[15rem]">{t('landing.attrib.p1Label')}</div>
                </div>
                <div>
                  <div className="font-mono text-3xl font-bold text-black dark:text-white mb-1 tabular-nums">{t('landing.attrib.p2')}</div>
                  <div className="text-sm text-neutral-500 max-w-[15rem]">{t('landing.attrib.p2Label')}</div>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-black/10 dark:border-white/10 bg-[#FAFAFA] dark:bg-[#0C0C0C] overflow-hidden shadow-xl">
              <div className="px-5 py-3 border-b border-black/5 dark:border-white/10 bg-white dark:bg-[#111] flex items-center gap-2">
                <ArrowLeftRight className="w-4 h-4 text-amber-500" />
                <span className="font-mono text-xs uppercase tracking-widest text-neutral-500">{t('landing.mock.trailHead')}</span>
              </div>
              <div className="divide-y divide-black/5 dark:divide-white/5">
                <div className="px-5 py-4 flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Bot className="w-3.5 h-3.5 text-amber-600 dark:text-amber-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-black dark:text-white font-semibold">{t('landing.attrib.rowAgent')}</p>
                    <p className="text-sm text-neutral-500">{t('landing.attrib.rowAgentAction')}</p>
                  </div>
                </div>
                <div className="px-5 py-4 flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <User className="w-3.5 h-3.5 text-neutral-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-black dark:text-white font-semibold">{t('landing.attrib.rowHuman')}</p>
                    <p className="text-sm text-neutral-500">{t('landing.attrib.rowHumanAction')}</p>
                  </div>
                </div>
                <div className="px-5 py-4 flex items-start gap-3 bg-neutral-50 dark:bg-black/30">
                  <div className="w-7 h-7 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <KeyRound className="w-3.5 h-3.5 text-neutral-500" />
                  </div>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400">{t('landing.attrib.revoke')}</p>
                </div>
              </div>
            </div>
          </div>
          <p className="mt-10 text-sm text-neutral-500 max-w-2xl">{t('landing.counter.asof')}</p>
        </div>
      </section>

      {/* ══ 09 — Pricing ══ */}
      <section id="pricing" className="py-16 sm:py-32 border-t border-black/5 dark:border-white/5 bg-[#F3EFE7] dark:bg-[#080808] transition-colors relative z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="mb-12 sm:mb-16 text-center max-w-3xl mx-auto">
            <p className="text-xs font-bold text-amber-500 uppercase tracking-widest mb-3">{t('landing.pricing.badge')}</p>
            <h2 className="font-display text-4xl sm:text-5xl md:text-7xl text-black dark:text-white mb-6 uppercase tracking-tight">{t('landing.pricing.title1')}<br />{t('landing.pricing.title2')}</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Free */}
            <div className="p-8 rounded-xl border border-black/5 dark:border-white/5 bg-white dark:bg-neutral-900/20 hover:shadow-xl transition-all flex flex-col">
              <h3 className="text-lg font-display uppercase tracking-wide text-black dark:text-white mb-2">{t('landing.pricing.free')}</h3>
              <div className="flex items-baseline gap-1 mb-2">
                <span className="text-4xl font-display font-bold text-black dark:text-white">{t('landing.pricing.freePrice')}</span>
                <span className="text-sm text-neutral-500">{t('landing.pricing.freePeriod')}</span>
              </div>
              <p className="text-sm text-neutral-500 mb-6">{t('landing.pricing.freeDesc')}</p>
              <ul className="space-y-3 mb-8 flex-1">
                {['freeF1', 'freeF2', 'freeF3', 'freeF4', 'freeF5'].map(k => (
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
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-amber-500 text-black text-xs font-bold uppercase tracking-wider">{t('landing.pricing.popular')}</div>
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
            <div className="p-8 rounded-xl border border-black/5 dark:border-white/5 bg-white dark:bg-neutral-900/20 hover:shadow-xl transition-all flex flex-col">
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
              <a href="mailto:haros@agentmail.to?subject=Baaton%20Enterprise" className="w-full py-3 rounded-lg border border-black/10 dark:border-white/10 text-center text-sm font-bold text-black dark:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">
                {t('landing.pricing.enterpriseCta')}
              </a>
            </div>
          </div>
          <p className="text-center text-sm text-neutral-500 mt-8">{t('landing.readDocs')} → <Link to="/docs" className="text-amber-500 hover:underline">{t('landing.nav.docs')}</Link></p>
        </div>
      </section>

      {/* ── CTA final ────────────────────────── */}
      <section className="py-16 sm:py-32 border-t border-black/5 dark:border-white/5 relative overflow-hidden bg-white dark:bg-[#050505] transition-colors z-20">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-amber-500/5 blur-[120px] rounded-full pointer-events-none" />
        <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center relative z-10">
          <h2 className="font-display text-[10vw] sm:text-7xl font-black text-black dark:text-white tracking-tight mb-8 leading-[0.85] uppercase">
            {t('landing.ctaTitle1')}<br />{t('landing.ctaTitle2')}
          </h2>
          <p className="text-xl text-neutral-600 dark:text-neutral-400 mb-12 max-w-2xl mx-auto font-medium">
            {t('landing.ctaSub')}
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
            <Link to="/sign-up" className="h-14 px-10 rounded-lg bg-black dark:bg-white text-white dark:text-black text-lg font-bold hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors flex items-center gap-2 w-full sm:w-auto justify-center shadow-xl transform hover:-translate-y-1">
              {t('landing.cta')} <ArrowRight className="w-5 h-5" strokeWidth={2} />
            </Link>
            <a href="#start" className="h-14 px-10 rounded-lg border border-black/10 dark:border-white/10 text-black dark:text-white text-lg font-bold hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors flex items-center gap-2 w-full sm:w-auto justify-center">
              <Terminal className="w-5 h-5" /> {t('landing.ctaSecondary')}
            </a>
          </div>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}

/* ── Sub-components ──────────────────────────── */

function FeatureCard({ icon, title, desc, glow }: { icon: React.ReactNode; title: string; desc: string; glow?: boolean }) {
  return (
    <div className="p-8 rounded-xl border border-black/5 dark:border-white/5 bg-white dark:bg-neutral-900/20 hover:bg-white dark:hover:bg-neutral-900/40 hover:shadow-xl dark:hover:shadow-none transition-all group relative overflow-hidden">
      {glow && <div className="absolute -right-12 -top-12 w-40 h-40 bg-amber-500/10 rounded-full blur-3xl group-hover:bg-amber-500/20 transition-colors" />}
      <div className="w-12 h-12 rounded-lg bg-white dark:bg-neutral-800 flex items-center justify-center mb-8 border border-black/5 dark:border-white/5 shadow-sm">
        {icon}
      </div>
      <h3 className="text-2xl font-display uppercase tracking-wide text-black dark:text-white mb-4">{title}</h3>
      <p className="text-base text-neutral-600 dark:text-neutral-400 leading-relaxed font-medium">{desc}</p>
    </div>
  );
}

/* ── Animated API Demo Terminal ─────────────── */
const DEMO_LINES: { type: 'cmd' | 'response' | 'hint' | 'pause'; text: string; color?: string; delay: number }[] = [
  { type: 'cmd', text: '$ curl -X POST api.baaton.dev/v1/issues \\', delay: 0 },
  { type: 'cmd', text: '    -H "Authorization: Bearer baa_2d70...c9a4" \\', delay: 300 },
  { type: 'cmd', text: '    -d \'{"title": "Fix auth timeout on mobile Safari", "priority": "high", "issue_type": "bug"}\'', delay: 600 },
  { type: 'pause', text: '', delay: 800 },
  { type: 'response', text: '{"data": {"display_id": "CRAIE-52", "status": "backlog", "due_date": null}}', color: 'text-green-400', delay: 400 },
  { type: 'hint', text: '→ _hint: {action: "add_description", reason: "Add detailed description to help triage"}', color: 'text-amber-400', delay: 600 },
  { type: 'hint', text: '→ _hint: {action: "add_tldr", reason: "Add TLDR summary of work to be done"}', color: 'text-amber-400', delay: 400 },
  { type: 'pause', text: '', delay: 1200 },
  { type: 'cmd', text: '$ curl -X PATCH api.baaton.dev/v1/issues/CRAIE-52 \\', delay: 0 },
  { type: 'cmd', text: '    -d \'{"status": "in_progress"}\'', delay: 500 },
  { type: 'response', text: '{"data": {"status": "in_progress", "status_changed_at": "2026-05-17T21:11:45Z"}}', color: 'text-green-400', delay: 400 },
  { type: 'hint', text: '→ _hint: {action: "add_comment", reason: "Status changed. Explain why."}', color: 'text-amber-400', delay: 500 },
  { type: 'pause', text: '', delay: 1400 },
  { type: 'cmd', text: '$ # ... agent works: reads context, fixes code, runs tests (47s) ...', delay: 0 },
  { type: 'pause', text: '', delay: 1200 },
  { type: 'cmd', text: '$ curl -X POST api.baaton.dev/v1/issues/CRAIE-52/tldr \\', delay: 0 },
  { type: 'cmd', text: '    -d \'{"agent_name": "claude-code", "summary": "Fixed auth timeout. Root cause: token refresh race condition.", "tests_status": "passed"}\'', delay: 600 },
  { type: 'response', text: '{"data": {"agent_name": "claude-code", "summary": "Fixed auth timeout..."}}', color: 'text-green-400', delay: 400 },
  { type: 'hint', text: '→ _hint: {action: "move_to_review", reason: "TLDR posted. Move to in_review for human verification."}', color: 'text-amber-400', delay: 600 },
  { type: 'pause', text: '', delay: 1000 },
  { type: 'cmd', text: '$ curl -X PATCH api.baaton.dev/v1/issues/CRAIE-52 -d \'{"status": "in_review"}\'', delay: 0 },
  { type: 'response', text: '{"data": {"status": "in_review", "actor": "Ramzi (via Sextan key)"}}', color: 'text-green-400', delay: 400 },
  { type: 'hint', text: '→ _hint: {action: "review_context", reason: "Check if project context needs updating."}', color: 'text-amber-400', delay: 500 },
  { type: 'pause', text: '', delay: 800 },
  { type: 'response', text: '✓ Done. Human notified. 47 seconds. Zero UI opened.', color: 'text-emerald-400', delay: 500 },
];

function ApiDemo() {
  const [visibleLines, setVisibleLines] = useState(0);
  const [started, setStarted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && !started) setStarted(true); },
      { threshold: 0.3 }
    );
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started) return;
    let totalDelay = 0;
    const timers: NodeJS.Timeout[] = [];
    DEMO_LINES.forEach((l, i) => {
      totalDelay += l.delay + (l.type === 'cmd' ? 400 : 200);
      timers.push(setTimeout(() => setVisibleLines(i + 1), totalDelay));
    });
    // Loop after completion
    timers.push(setTimeout(() => { setVisibleLines(0); setStarted(false); setTimeout(() => setStarted(true), 2000); }, totalDelay + 3000));
    return () => timers.forEach(clearTimeout);
  }, [started]);

  return (
    <div ref={containerRef} className="rounded-xl border border-black/10 dark:border-white/10 bg-[#0a0a0a] overflow-hidden shadow-2xl shadow-black/20">
      {/* Terminal header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10 bg-black/40">
        <div className="w-3 h-3 rounded-full bg-[#FF5F56]" />
        <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
        <div className="w-3 h-3 rounded-full bg-[#27C93F]" />
        <span className="ml-3 text-xs text-neutral-500 font-mono">agent-workflow.sh · 47s from issue to review</span>
      </div>
      {/* Terminal content */}
      <div className="p-5 sm:p-6 font-mono text-xs sm:text-sm space-y-1.5 min-h-[320px] overflow-hidden">
        {DEMO_LINES.slice(0, visibleLines).filter(l => l.type !== 'pause').map((line, i) => (
          <div
            key={i}
            className={`transition-opacity duration-300 ${
              line.type === 'cmd' ? 'text-neutral-300' :
              line.type === 'hint' ? `${line.color} text-xs opacity-80 pl-2 border-l-2 border-amber-500/30` :
              line.color || 'text-green-400'
            }`}
          >
            {line.text}
          </div>
        ))}
        {visibleLines < DEMO_LINES.length && visibleLines > 0 && (
          <span className="inline-block w-2 h-4 bg-amber-500 animate-pulse" />
        )}
      </div>
    </div>
  );
}

export default Landing;
// build: 1774440000
