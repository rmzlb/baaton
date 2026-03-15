import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useScroll, useTransform, type Variants } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { PixelTanuki } from '@/components/shared/PixelTanuki';
import { useTranslation } from '@/hooks/useTranslation';

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.12, duration: 0.7, ease: [0.16, 1, 0.3, 1] as const },
  }),
};

// ─── Code snippet tabs ─────────────────────────

const CODE_SNIPPETS: Record<string, string> = {
  cURL: `curl -X POST https://api.baaton.dev/api/v1/issues \\
  -H "Authorization: Bearer $BAATON_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "project_id": "uuid-here",
    "title": "Fix login timeout bug",
    "issue_type": "bug",
    "priority": "high",
    "assignee_ids": ["agent:claude-code"]
  }'`,

  Python: `import httpx

client = httpx.Client(
    base_url="https://api.baaton.dev/api/v1",
    headers={"Authorization": f"Bearer {BAATON_KEY}"}
)

issue = client.post("/issues", json={
    "project_id": "uuid-here",
    "title": "Fix login timeout bug",
    "issue_type": "bug",
    "priority": "high",
    "assignee_ids": ["agent:claude-code"],
}).json()

print(f"Created: {issue['data']['display_id']}")`,

  TypeScript: `import { BaatonClient } from "@baaton/sdk";

const baaton = new BaatonClient({ apiKey: process.env.BAATON_KEY });

const issue = await baaton.issues.create({
  projectId: "uuid-here",
  title: "Fix login timeout bug",
  issueType: "bug",
  priority: "high",
  assigneeIds: ["agent:claude-code"],
});

console.log(\`Created: \${issue.displayId}\`);`,
};

type LangTab = 'cURL' | 'Python' | 'TypeScript';

function CodeSnippet() {
  const [lang, setLang] = useState<LangTab>('cURL');

  return (
    <div className="w-full max-w-2xl mx-auto rounded-xl border border-border bg-surface/80 backdrop-blur-sm overflow-hidden shadow-2xl">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border bg-surface/50 px-1">
        {(Object.keys(CODE_SNIPPETS) as LangTab[]).map((l) => (
          <button
            key={l}
            onClick={() => setLang(l)}
            className={`px-4 py-2.5 text-xs font-medium transition-colors ${
              lang === l
                ? 'text-amber-400 border-b border-amber-400 -mb-px'
                : 'text-muted hover:text-secondary'
            }`}
          >
            {l}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5 px-3">
          <span className="w-2 h-2 rounded-full bg-red-500/40" />
          <span className="w-2 h-2 rounded-full bg-yellow-500/40" />
          <span className="w-2 h-2 rounded-full bg-green-500/40" />
        </div>
      </div>
      {/* Code */}
      <pre className="p-4 text-xs leading-relaxed font-mono text-secondary overflow-x-auto whitespace-pre">
        <code>{CODE_SNIPPETS[lang]}</code>
      </pre>
    </div>
  );
}

// ─── Hero ──────────────────────────────────────

export function Hero() {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end start'],
  });
  const yParallax = useTransform(scrollYProgress, [0, 1], [0, 150]);
  const opacityFade = useTransform(scrollYProgress, [0, 0.6], [1, 0]);

  return (
    <section
      ref={containerRef}
      className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20 pb-24 md:pt-0 md:pb-0"
      aria-label="Hero"
    >
      {/* Background grid */}
      <div className="absolute inset-0 bg-grid-pattern bg-[size:4rem_4rem] opacity-[0.03] pointer-events-none" />

      {/* Radial glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-gradient-radial from-amber-500/10 to-transparent opacity-60 pointer-events-none" />

      {/* Gradient fade */}
      <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-bg to-transparent pointer-events-none z-10" />

      <motion.div
        style={{ y: yParallax, opacity: opacityFade }}
        className="relative z-20 max-w-5xl mx-auto px-6 text-center flex flex-col items-center"
      >
        {/* Badge */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={0}
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-surface border border-border mb-8 backdrop-blur-sm"
        >
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-xs font-medium text-secondary tracking-wide">
            {t('landing.badge')}
          </span>
        </motion.div>

        {/* Tanuki mascot */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={1}
          className="mb-8"
        >
          <motion.div
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          >
            <PixelTanuki size={80} className="drop-shadow-[0_0_20px_rgba(245,158,11,0.3)]" />
          </motion.div>
        </motion.div>

        {/* Headline — agent-first */}
        <motion.h1
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={2}
          className="text-5xl sm:text-6xl md:text-8xl font-bold tracking-tight text-primary leading-[0.95] mb-6"
        >
          {t('landing.heroLine1')}
          <br />
          <span className="bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent">
            {t('landing.heroLine2')}
          </span>
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={3}
          className="text-lg md:text-xl text-secondary max-w-2xl mx-auto leading-relaxed mb-10"
        >
          {t('landing.heroSub')}
        </motion.p>

        {/* CTAs */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={4}
          className="flex flex-col sm:flex-row items-center gap-4 mb-14"
        >
          <Link
            to="/sign-up"
            className="group h-12 px-8 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-black font-semibold text-base transition-all hover:brightness-110 hover:shadow-[0_0_30px_rgba(245,158,11,0.3)] flex items-center gap-2"
          >
            {t('landing.cta')}
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
          </Link>
          <a
            href="https://github.com/IIIStormIII/baaton"
            target="_blank"
            rel="noopener noreferrer"
            className="h-12 px-8 rounded-lg border border-border text-secondary font-medium text-base hover:text-primary hover:border-white/20 transition-all flex items-center gap-2"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
            </svg>
            {t('landing.github')}
          </a>
        </motion.div>

        {/* Board preview — product first, code second */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={5}
          className="w-full max-w-4xl mx-auto mb-12"
        >
          <div className="rounded-xl border border-border bg-surface/60 backdrop-blur-sm overflow-hidden shadow-2xl">
            {/* Window chrome */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-surface/80">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500/40" />
              <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/40" />
              <span className="w-2.5 h-2.5 rounded-full bg-green-500/40" />
              <span className="ml-3 text-xs text-muted font-mono">baaton.dev/project/acme</span>
            </div>
            {/* Kanban columns */}
            <div className="grid grid-cols-4 gap-0 divide-x divide-border min-h-[220px]">
              {/* Backlog */}
              <div className="p-3">
                <div className="flex items-center gap-1.5 mb-3">
                  <span className="w-2 h-2 rounded-full bg-zinc-500" />
                  <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Backlog</span>
                  <span className="text-[10px] text-muted ml-auto">3</span>
                </div>
                <div className="space-y-2">
                  <div className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                    <p className="text-[10px] font-medium text-primary truncate">ACM-12 Add dark mode</p>
                    <p className="text-[9px] text-muted mt-0.5">Feature · Low</p>
                  </div>
                  <div className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                    <p className="text-[10px] font-medium text-primary truncate">ACM-15 i18n support</p>
                    <p className="text-[9px] text-muted mt-0.5">Feature · Medium</p>
                  </div>
                </div>
              </div>
              {/* In Progress — agent working */}
              <div className="p-3">
                <div className="flex items-center gap-1.5 mb-3">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">In Progress</span>
                  <span className="text-[10px] text-muted ml-auto">1</span>
                </div>
                <div className="space-y-2">
                  <div className="p-2 rounded-lg bg-amber-500/[0.06] border border-amber-500/[0.12]">
                    <p className="text-[10px] font-medium text-primary truncate">ACM-08 Fix login timeout</p>
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-[8px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium">🤖 agent</span>
                      <span className="text-[9px] text-amber-400/70">High</span>
                    </div>
                  </div>
                </div>
              </div>
              {/* In Review */}
              <div className="p-3">
                <div className="flex items-center gap-1.5 mb-3">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Review</span>
                  <span className="text-[10px] text-muted ml-auto">2</span>
                </div>
                <div className="space-y-2">
                  <div className="p-2 rounded-lg bg-blue-500/[0.06] border border-blue-500/[0.12]">
                    <p className="text-[10px] font-medium text-primary truncate">ACM-05 API rate limiting</p>
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-[8px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 font-medium">✅ TLDR posted</span>
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                    <p className="text-[10px] font-medium text-primary truncate">ACM-06 Webhook retry</p>
                    <p className="text-[9px] text-muted mt-0.5">Bug · Urgent</p>
                  </div>
                </div>
              </div>
              {/* Done */}
              <div className="p-3">
                <div className="flex items-center gap-1.5 mb-3">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Done</span>
                  <span className="text-[10px] text-muted ml-auto">5</span>
                </div>
                <div className="space-y-2">
                  <div className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.05] opacity-60">
                    <p className="text-[10px] font-medium text-primary truncate">ACM-03 Auth middleware</p>
                    <p className="text-[9px] text-muted mt-0.5">Closed 2h ago</p>
                  </div>
                  <div className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.05] opacity-60">
                    <p className="text-[10px] font-medium text-primary truncate">ACM-01 Setup CI/CD</p>
                    <p className="text-[9px] text-muted mt-0.5">Closed 1d ago</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Code snippet */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={6}
          className="w-full"
        >
          <p className="text-xs text-muted mb-3 uppercase tracking-wider">
            Your agent creates issues like this
          </p>
          <CodeSnippet />
        </motion.div>

        {/* Social proof */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={7}
          className="mt-12 flex items-center gap-3 text-muted text-sm"
        >
          <svg className="w-5 h-5 text-amber-500/70" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
          </svg>
          <span>{t('landing.socialProof')}</span>
        </motion.div>
      </motion.div>
    </section>
  );
}
