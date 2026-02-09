import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import {
  LayoutGrid,
  Bot,
  GitBranch,
  Radio,
  Building2,
  Languages,
  AlertCircle,
  Clock,
  Puzzle,
} from 'lucide-react';

/* ─── Animation helpers ─────────────────────── */
const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.6, ease: [0.16, 1, 0.3, 1] },
  }),
};

const stagger = {
  visible: { transition: { staggerChildren: 0.08 } },
};

/* ─── Pain points data ──────────────────────── */
const painPoints = [
  {
    icon: AlertCircle,
    problem: 'AI agents run unsupervised',
    solution: 'Every agent task is a tracked issue with status, logs, and human review gates.',
  },
  {
    icon: Clock,
    problem: 'Context lost across tools',
    solution: 'One board connects your code, PRs, and AI conversations in a single view.',
  },
  {
    icon: Puzzle,
    problem: 'No structure for AI workflows',
    solution: 'Purpose-built columns, assignments, and automations designed for human + AI teams.',
  },
];

/* ─── Features data ─────────────────────────── */
const features = [
  {
    icon: LayoutGrid,
    title: 'Kanban & List Views',
    description: 'Drag-and-drop boards and dense list views to manage issues however you prefer.',
  },
  {
    icon: Bot,
    title: 'AI Assistant',
    description: 'Chat with your board. Create issues, triage bugs, and get summaries — all in natural language.',
  },
  {
    icon: GitBranch,
    title: 'GitHub Sync',
    description: 'Two-way sync with GitHub Issues. PRs auto-link, branches auto-create, status auto-updates.',
  },
  {
    icon: Radio,
    title: 'Real-time SSE',
    description: 'Live updates via Server-Sent Events. See changes as they happen across your team.',
  },
  {
    icon: Building2,
    title: 'Multi-organization',
    description: 'Switch between orgs seamlessly. Each workspace is isolated with its own projects and members.',
  },
  {
    icon: Languages,
    title: 'Internationalization',
    description: 'Full i18n support out of the box. English and French included, easily extensible.',
  },
];

/* ─── AI Demo messages ──────────────────────── */
const demoMessages = [
  { role: 'user' as const, text: 'Create a high-priority bug for the login timeout issue' },
  {
    role: 'ai' as const,
    text: 'Created issue BAT-247: "Login session timeout after 5 minutes of inactivity". Priority set to high, assigned to backlog.',
  },
  { role: 'user' as const, text: 'Assign it to the AI agent and link the auth repo' },
  {
    role: 'ai' as const,
    text: 'Done. BAT-247 assigned to @claude-agent. Linked to github.com/baaton/auth — the agent is now analyzing the session middleware.',
  },
];

/* ─── Integration logos (SVG inlined) ───────── */
const integrations = [
  {
    name: 'GitHub',
    svg: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8">
        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
      </svg>
    ),
  },
  {
    name: 'OpenClaw',
    svg: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l7 4.5-7 4.5z" />
      </svg>
    ),
  },
  {
    name: 'Gemini',
    svg: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      </svg>
    ),
  },
];

/* ─── Component ─────────────────────────────── */
export function Features() {
  const problemRef = useRef<HTMLDivElement>(null);
  const featuresRef = useRef<HTMLDivElement>(null);
  const demoRef = useRef<HTMLDivElement>(null);
  const integrationsRef = useRef<HTMLDivElement>(null);

  const problemInView = useInView(problemRef, { once: true, margin: '-80px' });
  const featuresInView = useInView(featuresRef, { once: true, margin: '-80px' });
  const demoInView = useInView(demoRef, { once: true, margin: '-80px' });
  const integrationsInView = useInView(integrationsRef, { once: true, margin: '-80px' });

  return (
    <>
      {/* ── Problem → Solution ────────────────── */}
      <section className="relative py-24 md:py-32" aria-label="Problems and solutions">
        <div className="max-w-5xl mx-auto px-6">
          <motion.div
            ref={problemRef}
            initial="hidden"
            animate={problemInView ? 'visible' : 'hidden'}
            variants={stagger}
          >
            <motion.p
              variants={fadeUp}
              custom={0}
              className="text-sm font-medium text-amber-500 tracking-wide uppercase mb-3"
            >
              The Problem
            </motion.p>
            <motion.h2
              variants={fadeUp}
              custom={1}
              className="text-3xl sm:text-4xl md:text-5xl font-bold text-primary tracking-tight mb-16"
            >
              AI is powerful.
              <br />
              <span className="text-secondary">Managing it isn't.</span>
            </motion.h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {painPoints.map((point, i) => (
                <motion.div
                  key={point.problem}
                  variants={fadeUp}
                  custom={i + 2}
                  className="group p-6 rounded-xl border border-border bg-surface/50 hover:bg-surface-hover transition-colors"
                >
                  <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center mb-4 group-hover:bg-amber-500/10 transition-colors">
                    <point.icon className="w-5 h-5 text-red-400 group-hover:text-amber-500 transition-colors" />
                  </div>
                  <p className="text-sm font-medium text-red-400 group-hover:text-amber-500 mb-2 transition-colors">
                    {point.problem}
                  </p>
                  <p className="text-sm text-secondary leading-relaxed">
                    {point.solution}
                  </p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Features Grid ─────────────────────── */}
      <section id="features" className="relative py-24 md:py-32" aria-label="Features">
        <div className="max-w-5xl mx-auto px-6">
          <motion.div
            ref={featuresRef}
            initial="hidden"
            animate={featuresInView ? 'visible' : 'hidden'}
            variants={stagger}
          >
            <motion.p
              variants={fadeUp}
              custom={0}
              className="text-sm font-medium text-amber-500 tracking-wide uppercase mb-3"
            >
              Features
            </motion.p>
            <motion.h2
              variants={fadeUp}
              custom={1}
              className="text-3xl sm:text-4xl md:text-5xl font-bold text-primary tracking-tight mb-16"
            >
              Everything you need.
              <br />
              <span className="text-secondary">Nothing you don't.</span>
            </motion.h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {features.map((feature, i) => (
                <motion.div
                  key={feature.title}
                  variants={fadeUp}
                  custom={i + 2}
                  className="group relative p-6 rounded-xl border border-border bg-surface/30 hover:bg-surface/60 hover:border-white/[0.1] transition-all"
                >
                  {/* Subtle corner glow on hover */}
                  <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/0 group-hover:bg-amber-500/[0.04] rounded-bl-full transition-colors pointer-events-none" />

                  <div className="relative">
                    <div className="w-10 h-10 rounded-lg bg-white/[0.05] border border-white/[0.06] flex items-center justify-center mb-4">
                      <feature.icon className="w-5 h-5 text-primary" strokeWidth={1.5} />
                    </div>
                    <h3 className="text-base font-semibold text-primary mb-2">
                      {feature.title}
                    </h3>
                    <p className="text-sm text-secondary leading-relaxed">
                      {feature.description}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── AI Demo ───────────────────────────── */}
      <section className="relative py-24 md:py-32" aria-label="AI assistant demo">
        <div className="max-w-5xl mx-auto px-6">
          <motion.div
            ref={demoRef}
            initial="hidden"
            animate={demoInView ? 'visible' : 'hidden'}
            variants={stagger}
          >
            <motion.p
              variants={fadeUp}
              custom={0}
              className="text-sm font-medium text-amber-500 tracking-wide uppercase mb-3"
            >
              AI-Native
            </motion.p>
            <motion.h2
              variants={fadeUp}
              custom={1}
              className="text-3xl sm:text-4xl md:text-5xl font-bold text-primary tracking-tight mb-16"
            >
              Talk to your board.
            </motion.h2>

            <motion.div
              variants={fadeUp}
              custom={2}
              className="max-w-2xl mx-auto rounded-xl border border-border bg-surface/50 overflow-hidden"
            >
              {/* Chat header */}
              <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border bg-surface/80">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
                  <Bot className="w-4 h-4 text-black" strokeWidth={2.5} />
                </div>
                <div>
                  <p className="text-sm font-medium text-primary">Baaton AI</p>
                  <p className="text-xs text-muted">Online</p>
                </div>
              </div>

              {/* Messages */}
              <div className="p-5 space-y-4">
                {demoMessages.map((msg, i) => (
                  <motion.div
                    key={i}
                    variants={fadeUp}
                    custom={i + 3}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] px-4 py-2.5 rounded-xl text-sm leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-white/[0.07] text-primary rounded-br-md'
                          : 'bg-amber-500/[0.08] border border-amber-500/[0.12] text-primary rounded-bl-md'
                      }`}
                    >
                      {msg.text}
                    </div>
                  </motion.div>
                ))}

                {/* Typing indicator */}
                <motion.div
                  variants={fadeUp}
                  custom={7}
                  className="flex justify-start"
                >
                  <div className="bg-amber-500/[0.08] border border-amber-500/[0.12] px-4 py-3 rounded-xl rounded-bl-md flex gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500/60 animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500/60 animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500/60 animate-bounce [animation-delay:300ms]" />
                  </div>
                </motion.div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ── Integrations ──────────────────────── */}
      <section className="relative py-24 md:py-32" aria-label="Integrations">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <motion.div
            ref={integrationsRef}
            initial="hidden"
            animate={integrationsInView ? 'visible' : 'hidden'}
            variants={stagger}
          >
            <motion.p
              variants={fadeUp}
              custom={0}
              className="text-sm font-medium text-amber-500 tracking-wide uppercase mb-3"
            >
              Integrations
            </motion.p>
            <motion.h2
              variants={fadeUp}
              custom={1}
              className="text-3xl sm:text-4xl md:text-5xl font-bold text-primary tracking-tight mb-4"
            >
              Connects to your stack.
            </motion.h2>
            <motion.p
              variants={fadeUp}
              custom={2}
              className="text-secondary mb-16 max-w-lg mx-auto"
            >
              Plug into the tools your team already uses — with more integrations coming soon.
            </motion.p>

            <motion.div
              variants={fadeUp}
              custom={3}
              className="flex items-center justify-center gap-8 md:gap-16"
            >
              {integrations.map((integration, i) => (
                <motion.div
                  key={integration.name}
                  variants={fadeUp}
                  custom={i + 4}
                  className="flex flex-col items-center gap-3 text-muted hover:text-primary transition-colors group"
                >
                  <div className="w-16 h-16 rounded-xl bg-surface border border-border flex items-center justify-center group-hover:border-white/[0.12] transition-colors">
                    {integration.svg}
                  </div>
                  <span className="text-xs font-medium">{integration.name}</span>
                </motion.div>
              ))}
            </motion.div>
          </motion.div>
        </div>
      </section>
    </>
  );
}
