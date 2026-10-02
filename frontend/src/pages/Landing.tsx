import { useEffect, useRef, useState, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { ArrowRight, Sun, Moon, Menu, X } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useLandingTheme } from '@/hooks/useLandingTheme';
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { HeroFlow, LiveBoard, AgentTerminal, StatusMark, type StatusKey } from '@/components/landing/Flow';
import '@/components/landing/landing.css';

/* ─── Raw API calls, shown under "See the raw API calls" ─── */
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

const API_LINES: { tone: 'u' | 'o' | 'h'; text: string }[] = [
  { tone: 'u', text: '$ curl -X POST api.baaton.dev/v1/issues \\' },
  { tone: 'u', text: '    -H "Authorization: Bearer ***" \\' },
  { tone: 'u', text: '    -d \'{"title": "Fix auth timeout on mobile Safari", "priority": "high", "issue_type": "bug"}\'' },
  { tone: 'o', text: '{"data": {"display_id": "CRAIE-52", "status": "backlog", "due_date": null}}' },
  { tone: 'h', text: '→ _hint: {action: "add_description", reason: "Add detailed description to help triage"}' },
  { tone: 'h', text: '→ _hint: {action: "add_tldr", reason: "Add TLDR summary of work to be done"}' },
  { tone: 'u', text: '$ curl -X PATCH api.baaton.dev/v1/issues/CRAIE-52 \\' },
  { tone: 'u', text: '    -d \'{"status": "in_progress"}\'' },
  { tone: 'o', text: '{"data": {"status": "in_progress", "status_changed_at": "2026-05-17T21:11:45Z"}}' },
  { tone: 'h', text: '→ _hint: {action: "add_comment", reason: "Status changed. Explain why."}' },
  { tone: 'u', text: '$ # ... agent works: reads context, fixes code, runs tests (47s) ...' },
  { tone: 'u', text: '$ curl -X POST api.baaton.dev/v1/issues/CRAIE-52/tldr \\' },
  { tone: 'u', text: '    -d \'{"agent_name": "claude-code", "summary": "Fixed auth timeout. Root cause: token refresh race condition.", "tests_status": "passed"}\'' },
  { tone: 'o', text: '{"data": {"agent_name": "claude-code", "summary": "Fixed auth timeout..."}}' },
  { tone: 'h', text: '→ _hint: {action: "move_to_review", reason: "TLDR posted. Move to in_review for human verification."}' },
  { tone: 'u', text: '$ curl -X PATCH api.baaton.dev/v1/issues/CRAIE-52 -d \'{"status": "in_review"}\'' },
  { tone: 'o', text: '{"data": {"status": "in_review", "actor": "Ramzi (via Sextan key)"}}' },
  { tone: 'h', text: '→ _hint: {action: "review_context", reason: "Check if project context needs updating."}' },
  { tone: 'o', text: '✓ Done. Human notified. 47 seconds. Zero UI opened.' },
];

function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return { copied, copy };
}

function CodeTabs() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<string>('cURL');
  const { copied, copy } = useCopy(codeSnippets[tab]);
  return (
    <div className="term codetabs">
      <div className="tbar">
        <div role="tablist" aria-label="API">
          {Object.keys(codeSnippets).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : undefined} onClick={() => setTab(k)}>{k}</button>
          ))}
        </div>
        <button type="button" className="cbtn" onClick={copy}>{copied ? t('landing.start.copied') : t('landing.start.copy')}</button>
      </div>
      <pre>{codeSnippets[tab]}</pre>
    </div>
  );
}

function AgentPrompt() {
  const { t } = useTranslation();
  const prompt = t('landing.start.agentPrompt');
  const { copied, copy } = useCopy(prompt);
  return (
    <div className="prompt">
      <div className="prompt-h">
        <span>{t('landing.start.agentPromptLabel')}</span>
        <button type="button" onClick={copy}>{copied ? t('landing.start.copied') : t('landing.start.copy')}</button>
      </div>
      <p>{prompt}</p>
    </div>
  );
}

/* ─── Videos start muted once half on screen and load nothing before ─── */
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function useScrollPlay(ref: RefObject<HTMLVideoElement | null>) {
  useEffect(() => {
    const video = ref.current;
    if (!video || prefersReducedMotion()) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) video.pause();
      else if (!video.ended) video.play().catch(() => {});
    }, { threshold: 0.5 });
    observer.observe(video);
    return () => observer.disconnect();
  }, [ref]);
}

/* The "how it works" recording behaves like an animated GIF: muted, looping, no controls. */
function DemoVideo({ lang, label }: { lang: 'fr' | 'en'; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useScrollPlay(ref);
  return (
    <video ref={ref} muted loop playsInline preload="none" controls={prefersReducedMotion()} poster={`/demo-${lang}.jpg`} aria-label={label}>
      <source src={`/demo-${lang}.mp4`} type="video/mp4" />
    </video>
  );
}

/* ─── Film: plays muted on scroll; the button restarts it with sound ─── */
const FILM_MOMENTS: { title: string; status: StatusKey }[] = [
  { title: 'landing.flow.l1Title', status: 'draft' },
  { title: 'landing.flow.l2Title', status: 'progress' },
  { title: 'landing.flow.l3Title', status: 'review' },
  { title: 'landing.flow.l4Title', status: 'done' },
];

function Film() {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  useScrollPlay(video);
  const playWithSound = () => {
    const v = video.current;
    if (!v) return;
    v.scrollIntoView({ behavior: 'smooth', block: 'center' });
    v.muted = false;
    v.currentTime = 0;
    v.play().catch(() => {});
  };
  return (
    <>
      <ul className="rows">
        <li>
          <button type="button" className="row feat" onClick={playWithSound}>
            <span className="l">{t('landing.film.featured')}</span>
            <span className="t">{t('landing.film.alt')}</span>
            <span className="r">{t('landing.film.duration')}</span>
          </button>
        </li>
      </ul>
      <div className="player">
        <div className="frame">
          <video
            ref={video}
            src="/film/baaton-film.mp4"
            poster="/film/baaton-film.jpg"
            muted
            controls
            playsInline
            preload="none"
            onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
            aria-label={t('landing.film.alt')}
          />
          {muted && (
            <button type="button" className="play" onClick={playWithSound}><span>{t('landing.film.play')}</span></button>
          )}
        </div>
        <div className="bar"><span>{t('landing.film.bar')}</span><span className="track" /><span>{t('landing.film.duration')}</span></div>
      </div>
      <p className="trail-h" style={{ marginTop: 28 }}>{t('landing.film.journey')}</p>
      <ul className="rows tight moments num">
        {FILM_MOMENTS.map((m, i) => (
          <li key={m.title} className="row">
            <span className="l">0{i + 1}</span>
            <div className="t">{t(m.title)}</div>
            <span className="r"><StatusMark status={m.status} /></span>
          </li>
        ))}
      </ul>
    </>
  );
}

/* ─── Shared section frame: sticky title on the left, rows on the right ─── */
function Side({ kicker, title, lede, as: Tag = 'h2' }: { kicker: string; title: [string, string]; lede?: string; as?: 'h2' | 'h3' }) {
  return (
    <div className="sec-left">
      <p className="kicker">{kicker}</p>
      <Tag>{title[0]} <em>{title[1]}</em></Tag>
      {lede && <p className="lede">{lede}</p>}
    </div>
  );
}

function NumRows({ items }: { items: { title: string; desc: string }[] }) {
  return (
    <ul className="rows num">
      {items.map((it, i) => (
        <li key={it.title} className="row">
          <span className="l">0{i + 1}</span>
          <div><div className="t">{it.title}</div><div className="d">{it.desc}</div></div>
          <span className="r" />
        </li>
      ))}
    </ul>
  );
}

const FEATURES = ['collect', 'api', 'status', 'proof', 'multi', 'automations'];
const USE_CASES = ['coding', 'qa', 'devops', 'support'];
const PLANS = [
  { key: 'free', features: ['freeF1', 'freeF2', 'freeF3', 'freeF4', 'freeF5'] },
  { key: 'pro', features: ['proF1', 'proF2', 'proF3', 'proF4', 'proF5'] },
  { key: 'enterprise', features: ['enterpriseF1', 'enterpriseF2', 'enterpriseF3', 'enterpriseF4', 'enterpriseF5'] },
] as const;

const navLinks = [
  { href: '#how-it-works', key: 'landing.nav.features' },
  { href: '#pricing', key: 'landing.nav.pricing' },
];

export function Landing() {
  const { dark, toggle } = useLandingTheme();
  const { t, i18n } = useTranslation();
  const demoLang = i18n.language?.startsWith('en') ? 'en' : 'fr';
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // The Clerk session is shared between baaton.dev and app.baaton.dev.
  const { isSignedIn } = useAuth();

  return (
    <div className="lp">
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
          <div className="hidden xl:flex items-center gap-8 whitespace-nowrap text-sm font-semibold text-neutral-600 dark:text-neutral-400">
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
            {isSignedIn ? (
              <a href="/dashboard" className="hidden sm:flex px-5 py-2.5 bg-black dark:bg-white text-white dark:text-black text-sm font-bold rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all items-center gap-2 shadow-xl shadow-black/10 dark:shadow-white/5 transform hover:-translate-y-0.5">
                <span>{t('landing.nav.openApp')}</span>
                <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
              </a>
            ) : (
              <>
                <Link to="/sign-in" className="text-sm font-semibold text-neutral-900 dark:text-white hover:opacity-70 transition-opacity hidden sm:block">{t('landing.nav.login')}</Link>
                <Link to="/sign-up" className="hidden sm:flex px-5 py-2.5 bg-black dark:bg-white text-white dark:text-black text-sm font-bold rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all items-center gap-2 shadow-xl shadow-black/10 dark:shadow-white/5 transform hover:-translate-y-0.5">
                  <span>{t('landing.cta')}</span>
                  <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
                </Link>
              </>
            )}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="xl:hidden p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-neutral-900 dark:text-white transition-colors"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
        {mobileMenuOpen && (
          <div className="xl:hidden border-t border-black/5 dark:border-white/10 bg-[#F3EFE7] dark:bg-[#080808] px-4 py-4 space-y-3">
            {navLinks.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setMobileMenuOpen(false)} className="block text-sm font-semibold text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white py-2">{t(l.key)}</a>
            ))}
            <Link to="/compare" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-semibold text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white py-2">{t('landing.nav.methodology')}</Link>
            <Link to="/docs" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-semibold text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white py-2">{t('landing.nav.docs')}</Link>
            <Link to="/docs#api-reference" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-semibold text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white py-2">{t('landing.nav.api')}</Link>
            <div className="border-t border-black/5 dark:border-white/10 pt-3 flex flex-col gap-2">
              <LanguageSwitcher variant="full" className="py-1" />
              {isSignedIn ? (
                <a href="/dashboard" className="px-5 py-2.5 bg-black dark:bg-white text-white dark:text-black text-sm font-bold rounded-lg text-center">
                  {t('landing.nav.openApp')}
                </a>
              ) : (
                <>
                  <Link to="/sign-in" onClick={() => setMobileMenuOpen(false)} className="text-sm font-semibold text-neutral-900 dark:text-white py-2">{t('landing.nav.login')}</Link>
                  <Link to="/sign-up" onClick={() => setMobileMenuOpen(false)} className="px-5 py-2.5 bg-black dark:bg-white text-white dark:text-black text-sm font-bold rounded-lg text-center">
                    {t('landing.cta')}
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </nav>

      <main className="lp-main" id="top">
        <div className="lp-wrap">
          {/* ══ 01 — Hero, then one request through the real statuses ══ */}
          <HeroFlow />

          {/* ══ 01b — The film, right under the promise ══ */}
          <section className="sec" id="film">
            <div className="sec-grid">
              <Side kicker={t('landing.film.kicker')} title={[t('landing.film.title1'), t('landing.film.title2')]} lede={t('landing.film.note')} />
              <div className="sec-right"><Film /></div>
            </div>
          </section>

          {/* ══ 02 — The gap ══ */}
          <section className="sec" id="problem">
            <div className="sec-grid">
              <Side kicker={t('landing.gap.badge')} title={[t('landing.gap.title1'), t('landing.gap.title2')]} lede={t('landing.gap.sub')} />
              <div className="sec-right">
                <div className="gap-table">
                  <div className="gap-h"><div>{t('landing.gap.leftHead')}</div><div>{t('landing.gap.rightHead')}</div></div>
                  {(['1', '2', '3'] as const).map((i) => (
                    <div key={i} className="gap-p"><div>{t(`landing.gap.l${i}`)}</div><div>{t(`landing.gap.r${i}`)}</div></div>
                  ))}
                </div>
                <p className="note" style={{ marginTop: 16 }}>{t('landing.gap.note')}</p>
              </div>
            </div>
          </section>

          {/* ══ 03 — Why: the conviction, three principles, the founder ══ */}
          <section className="sec" id="why">
            <div className="sec-grid">
              <Side kicker={t('landing.manifesto.title')} title={[t('landing.why.title1'), t('landing.why.title2')]} lede={t('landing.manifesto.body')} />
              <div className="sec-right">
                <NumRows items={(['p1', 'p2', 'p3'] as const).map((p) => ({ title: t(`landing.why.${p}`), desc: t(`landing.why.${p}Desc`) }))} />
                <figure className="quote">
                  <blockquote>{t('landing.why.quote')}</blockquote>
                  <figcaption>{t('landing.why.quoteSign')}</figcaption>
                </figure>
              </div>
            </div>
          </section>

          {/* ══ 04 — Start: three ways in ══ */}
          <section className="sec" id="start">
            <div className="sec-grid">
              <Side kicker={t('landing.start.badge')} title={[t('landing.start.title1'), t('landing.start.title2')]} lede={t('landing.start.sub')} />
              <div className="sec-right">
                <ul className="rows num">
                  <li className="row">
                    <span className="l">01</span>
                    <div>
                      <div className="t">{t('landing.start.ui')}</div>
                      <div className="d">{t('landing.start.uiDesc')}</div>
                      <div className="act"><Link to="/sign-up" className="cta amber">{t('landing.cta')} <span aria-hidden="true">→</span></Link></div>
                    </div>
                    <span className="r" />
                  </li>
                  <li className="row">
                    <span className="l">02</span>
                    <div>
                      <div className="t">{t('landing.start.agent')}</div>
                      <div className="d">{t('landing.start.agentDesc')}</div>
                      <AgentPrompt />
                      <p className="note" style={{ marginTop: 10 }}>{t('landing.start.agentNote')}</p>
                    </div>
                    <span className="r" />
                  </li>
                  <li className="row">
                    <span className="l">03</span>
                    <div>
                      <div className="t">{t('landing.start.api')}</div>
                      <div className="d">{t('landing.start.apiDesc')}</div>
                      <div className="act">
                        <Link to="/docs#api-reference" className="ulink">{t('landing.nav.api')}</Link>
                        <a href="https://github.com/rmzlb/baaton" target="_blank" rel="noopener noreferrer" className="ulink">GitHub</a>
                      </div>
                    </div>
                    <span className="r" />
                  </li>
                </ul>
              </div>
            </div>
          </section>

          {/* ══ 05 — Every open ticket, the agent at work, then the real recordings ══ */}
          <section className="sec" id="how-it-works">
            <div className="sec-grid">
              <Side kicker={t('landing.demo.badge')} title={[t('landing.board.title1'), t('landing.board.title2')]} lede={t('landing.board.sub')} />
              <div className="sec-right"><LiveBoard /></div>
            </div>
            <div className="sec-grid">
              <Side as="h3" kicker={t('landing.agentUse.badge')} title={[t('landing.agentUse.title1'), t('landing.agentUse.title2')]} lede={t('landing.agentUse.sub')} />
              <div className="sec-right">
                <AgentTerminal />
                <div className="demo">
                  <DemoVideo key={demoLang} lang={demoLang} label={t('landing.mock.demoAlt')} />
                  <img src="/agent-demo.png" alt={t('landing.mock.agentDemoAlt')} loading="lazy" />
                  <p className="note">{t('landing.demo.note')}</p>
                  <details className="raw">
                    <summary><span className="ulink">{t('landing.demo.raw')}</span></summary>
                    <div className="term">
                      <div className="tbar"><span>agent-workflow.sh · 47s from issue to review</span></div>
                      <pre>
                        {API_LINES.map((l, i) => (
                          <span key={i} className={l.tone}>{l.text}{i < API_LINES.length - 1 ? '\n' : ''}</span>
                        ))}
                      </pre>
                    </div>
                    <div style={{ marginTop: 16 }}><CodeTabs /></div>
                  </details>
                </div>
              </div>
            </div>
          </section>

          {/* ══ 06 — What the agents do in it ══ */}
          <section className="sec" id="features">
            <div className="sec-grid">
              <Side kicker={t('landing.features.badge')} title={[t('landing.features.title1'), t('landing.features.title2')]} lede={t('landing.features.sub')} />
              <div className="sec-right">
                <NumRows items={FEATURES.map((f) => ({ title: t(`landing.features.${f}`), desc: t(`landing.features.${f}Desc`) }))} />
              </div>
            </div>
          </section>

          {/* ══ 07 — Who it is for ══ */}
          <section className="sec" id="for-who">
            <div className="sec-grid">
              <Side kicker={t('landing.useCases.badge')} title={[t('landing.useCases.title1'), t('landing.useCases.title2')]} />
              <div className="sec-right">
                <NumRows items={USE_CASES.map((u) => ({ title: t(`landing.useCases.${u}`), desc: t(`landing.useCases.${u}Desc`) }))} />
              </div>
            </div>
          </section>

          {/* ══ 08 — Proof: our own board ══ */}
          <section className="sec" id="proof">
            <div className="sec-grid">
              <Side kicker={t('landing.counter.badge')} title={[t('landing.counter.title1'), t('landing.counter.title2')]} lede={t('landing.counter.sub')} />
              <div className="sec-right">
                <div className="nums">
                  {(['n1', 'n2', 'n3', 'n4'] as const).map((n) => (
                    <div key={n}><b>{t(`landing.counter.${n}`)}</b><span>{t(`landing.counter.${n}Label`)}</span></div>
                  ))}
                </div>
                <div className="attrib">
                  <h3>{t('landing.attrib.title')}</h3>
                  <p>{t('landing.attrib.sub')}</p>
                  <div className="pp">
                    <div><b>{t('landing.attrib.p1')}</b><span>{t('landing.attrib.p1Label')}</span></div>
                    <div><b>{t('landing.attrib.p2')}</b><span>{t('landing.attrib.p2Label')}</span></div>
                  </div>
                  <p className="trail-h">{t('landing.mock.trailHead')} · <span className="ex">{t('landing.flow.example')}</span></p>
                  <ul className="rows trail">
                    <li className="row"><span className="l">{t('landing.attrib.rowAgent')}</span><div className="t">{t('landing.attrib.rowAgentAction')}</div></li>
                    <li className="row"><span className="l">{t('landing.attrib.rowHuman')}</span><div className="t">{t('landing.attrib.rowHumanAction')}</div></li>
                    <li className="row"><span className="l">—</span><div className="t dim">{t('landing.attrib.revoke')}</div></li>
                  </ul>
                </div>
                <p className="note asof">{t('landing.counter.asof')}</p>
              </div>
            </div>
          </section>

          {/* ══ 09 — Pricing ══ */}
          <section className="sec" id="pricing">
            <div className="sec-grid">
              <Side kicker={t('landing.pricing.badge')} title={[t('landing.pricing.title1'), t('landing.pricing.title2')]} />
              <div className="sec-right">
                <ul className="rows prices">
                  {PLANS.map((p) => {
                    const period = t(`landing.pricing.${p.key}Period`);
                    return (
                      <li key={p.key} className="row">
                        <div>
                          <div className="pname">{t(`landing.pricing.${p.key}`)}</div>
                          <div className="pprice">{t(`landing.pricing.${p.key}Price`)}{period && <small>{period}</small>}</div>
                        </div>
                        <div>
                          <div className="d">{t(`landing.pricing.${p.key}Desc`)}</div>
                          <ul>{p.features.map((f) => <li key={f}>{t(`landing.pricing.${f}`)}</li>)}</ul>
                        </div>
                        <div className="r">
                          {p.key === 'free' && <Link to="/sign-up" className="ulink">{t('landing.pricing.freeCta')}</Link>}
                          {p.key === 'pro' && (
                            <>
                              <span className="pop">{t('landing.pricing.popular')}</span>
                              <Link to="/sign-up" className="cta amber">{t('landing.pricing.proCta')} <span aria-hidden="true">→</span></Link>
                            </>
                          )}
                          {p.key === 'enterprise' && <a href="mailto:haros@agentmail.to?subject=Baaton%20Enterprise" className="ulink">{t('landing.pricing.enterpriseCta')}</a>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <div className="more"><span>{t('landing.readDocs')}</span><Link to="/docs" className="ulink">{t('landing.nav.docs')}</Link></div>
              </div>
            </div>
          </section>

          {/* ══ 10 — Final CTA ══ */}
          <section className="sec final" id="cta">
            <div className="sec-grid">
              <Side kicker={t('landing.ctaBadge')} title={[t('landing.ctaTitle1'), t('landing.ctaTitle2')]} />
              <div className="sec-right">
                <p className="lede">{t('landing.ctaSub')}</p>
                <div className="btns">
                  <Link to="/sign-up" className="cta amber">{t('landing.cta')} <span aria-hidden="true">→</span></Link>
                  <a className="ulink" href="#start">{t('landing.ctaSecondary')}</a>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}

export default Landing;
