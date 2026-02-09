import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, useScroll, useTransform } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { PixelTanuki } from '@/components/shared/PixelTanuki';

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.12, duration: 0.7, ease: [0.16, 1, 0.3, 1] },
  }),
};

export function Hero() {
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
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-glow-dark opacity-60 pointer-events-none" />

      {/* Gradient fade to bg */}
      <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-[#0a0a0a] to-transparent pointer-events-none z-10" />

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
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] mb-8 backdrop-blur-sm"
        >
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-xs font-medium text-secondary tracking-wide">
            Now in public beta
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

        {/* Headline */}
        <motion.h1
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={2}
          className="text-5xl sm:text-6xl md:text-8xl font-bold tracking-tight text-primary leading-[0.95] mb-6"
        >
          You orchestrate.
          <br />
          <span className="bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent">
            AI executes.
          </span>
        </motion.h1>

        {/* Sub-headline */}
        <motion.p
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={3}
          className="text-lg md:text-xl text-secondary max-w-2xl mx-auto leading-relaxed mb-10"
        >
          The project management board built for the AI age. Assign issues to
          agents, review their work, ship faster — all from one command center.
        </motion.p>

        {/* CTAs */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={4}
          className="flex flex-col sm:flex-row items-center gap-4"
        >
          <Link
            to="/sign-up"
            className="group h-12 px-8 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-black font-semibold text-base transition-all hover:brightness-110 hover:shadow-[0_0_30px_rgba(245,158,11,0.3)] flex items-center gap-2"
          >
            Start for free
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
            View on GitHub
          </a>
        </motion.div>

        {/* Social proof hint */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={5}
          className="mt-12 flex items-center gap-3 text-muted text-sm"
        >
          <div className="flex -space-x-2">
            {['JD', 'AK', 'MR', 'LS'].map((initials) => (
              <div
                key={initials}
                className="w-7 h-7 rounded-full bg-surface border-2 border-bg flex items-center justify-center text-[10px] font-medium text-secondary"
              >
                {initials}
              </div>
            ))}
          </div>
          <span>Used by builders shipping with AI</span>
        </motion.div>
      </motion.div>
    </section>
  );
}
