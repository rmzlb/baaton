import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useInView } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { PixelTanuki } from '@/components/shared/PixelTanuki';

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

const footerLinks = {
  Product: [
    { label: 'Features', href: '#features' },
    { label: 'Pricing', href: '#pricing' },
    { label: 'Changelog', href: '#' },
    { label: 'Docs', href: '#' },
  ],
  Company: [
    { label: 'About', href: '#' },
    { label: 'Blog', href: '#' },
    { label: 'Careers', href: '#' },
  ],
  Legal: [
    { label: 'Privacy', href: '#' },
    { label: 'Terms', href: '#' },
  ],
};

export function Footer() {
  const ctaRef = useRef<HTMLDivElement>(null);
  const ctaInView = useInView(ctaRef, { once: true, margin: '-80px' });
  const [email, setEmail] = useState('');

  return (
    <>
      {/* ── Final CTA ────────────────────────── */}
      <section className="relative py-24 md:py-32 overflow-hidden" aria-label="Call to action">
        {/* Background glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-amber-500/[0.06] blur-[120px] rounded-full pointer-events-none" />

        <div className="max-w-3xl mx-auto px-6 text-center relative z-10">
          <motion.div
            ref={ctaRef}
            initial="hidden"
            animate={ctaInView ? 'visible' : 'hidden'}
            variants={stagger}
          >
            <motion.h2
              variants={fadeUp}
              custom={0}
              className="text-3xl sm:text-4xl md:text-5xl font-bold text-primary tracking-tight mb-4"
            >
              Start orchestrating today.
            </motion.h2>
            <motion.p
              variants={fadeUp}
              custom={1}
              className="text-secondary mb-10 max-w-lg mx-auto"
            >
              Free to start. Set up in under 2 minutes. No credit card required.
            </motion.p>

            {/* Email signup */}
            <motion.form
              variants={fadeUp}
              custom={2}
              onSubmit={(e) => {
                e.preventDefault();
                // Navigate to sign-up with email pre-filled
                window.location.href = `/sign-up?email=${encodeURIComponent(email)}`;
              }}
              className="flex flex-col sm:flex-row items-center gap-3 max-w-md mx-auto"
            >
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                className="flex-1 w-full h-12 px-4 rounded-lg bg-surface border border-border text-primary placeholder:text-muted text-sm focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 transition-colors"
                aria-label="Email address"
              />
              <button
                type="submit"
                className="group w-full sm:w-auto h-12 px-6 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-black font-semibold text-sm flex items-center justify-center gap-2 hover:brightness-110 transition-all shrink-0"
              >
                Get started
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </button>
            </motion.form>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────── */}
      <footer className="border-t border-border py-12 md:py-16" aria-label="Footer">
        <div className="max-w-5xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
            {/* Brand */}
            <div className="col-span-2">
              <Link to="/" className="flex items-center gap-2 mb-4" aria-label="Baaton home">
                <PixelTanuki size={28} />
                <span className="text-lg font-bold text-primary">Baaton</span>
              </Link>
              <p className="text-sm text-secondary leading-relaxed max-w-xs">
                The project board for humans who orchestrate AI. Track, assign, review, ship.
              </p>
            </div>

            {/* Link columns */}
            {Object.entries(footerLinks).map(([category, links]) => (
              <div key={category}>
                <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-4">
                  {category}
                </h4>
                <ul className="space-y-2.5" role="list">
                  {links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        className="text-sm text-secondary hover:text-primary transition-colors"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Bottom bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-8 border-t border-border">
            <p className="text-xs text-muted">
              © {new Date().getFullYear()} Baaton. All rights reserved.
            </p>
            <p className="text-xs text-muted flex items-center gap-1">
              Built with <PixelTanuki size={14} className="inline-block" /> by Baaton
            </p>
            <div className="flex items-center gap-4">
              <a
                href="https://github.com/IIIStormIII/baaton"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted hover:text-primary transition-colors"
                aria-label="GitHub"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
                </svg>
              </a>
              <a
                href="https://x.com/baaton_dev"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted hover:text-primary transition-colors"
                aria-label="Twitter / X"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              <a
                href="https://discord.gg/baaton"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted hover:text-primary transition-colors"
                aria-label="Discord"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
