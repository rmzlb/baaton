import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, ArrowRight } from 'lucide-react';
import { PixelTanuki } from '@/components/shared/PixelTanuki';
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher';
import { Hero } from '@/components/landing/Hero';
import { useTranslation } from '@/hooks/useTranslation';

// Lazy-load below-fold sections for performance
const Features = lazy(() =>
  import('@/components/landing/Features').then((m) => ({ default: m.Features })),
);
const Pricing = lazy(() =>
  import('@/components/landing/Pricing').then((m) => ({ default: m.Pricing })),
);
const Footer = lazy(() =>
  import('@/components/landing/Footer').then((m) => ({ default: m.Footer })),
);

export function Landing() {
  const { t } = useTranslation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navLinks = [
    { label: t('landing.nav.features'), href: '#features' },
    { label: t('landing.nav.pricing'), href: '#pricing' },
    { label: t('landing.nav.docs'), href: '/docs' },
  ];

  return (
    <div className="min-h-screen bg-bg text-primary selection:bg-amber-500/20 selection:text-primary">
      {/* Noise overlay */}
      <div className="noise" />

      {/* ── Navbar ────────────────────────────── */}
      <nav
        className="fixed top-0 w-full z-40 border-b border-border/50 bg-bg/80 dark:bg-bg/80 backdrop-blur-xl"
        role="navigation"
        aria-label="Main navigation"
      >
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 group" aria-label="Baaton home">
            <PixelTanuki size={24} className="group-hover:scale-110 transition-transform" />
            <span className="text-base font-bold text-primary">Baaton</span>
          </Link>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="text-sm text-secondary hover:text-primary transition-colors"
              >
                {link.label}
              </a>
            ))}
          </div>

          {/* Desktop CTAs */}
          <div className="hidden md:flex items-center gap-3">
            <LanguageSwitcher variant="compact" />
            <Link
              to="/sign-in"
              className="text-sm text-secondary hover:text-primary transition-colors"
            >
              {t('landing.nav.login')}
            </Link>
            <Link
              to="/sign-up"
              className="h-8 px-4 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-black text-sm font-semibold flex items-center gap-1.5 hover:brightness-110 transition-all"
            >
              {t('landing.cta')}
              <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.5} />
            </Link>
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-2 -mr-2 text-secondary hover:text-primary transition-colors"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile menu */}
        <AnimatePresence>
          {mobileOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="md:hidden overflow-hidden border-t border-border/50 bg-bg/95 backdrop-blur-xl"
            >
              <div className="px-6 py-4 space-y-3">
                {navLinks.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    onClick={() => setMobileOpen(false)}
                    className="block text-sm text-secondary hover:text-primary py-1.5 transition-colors"
                  >
                    {link.label}
                  </a>
                ))}
                <div className="pt-3 border-t border-border/50 flex flex-col gap-2">
                  <LanguageSwitcher variant="full" className="py-1.5" />
                  <Link
                    to="/sign-in"
                    onClick={() => setMobileOpen(false)}
                    className="text-sm text-secondary hover:text-primary py-1.5 transition-colors"
                  >
                    {t('landing.nav.login')}
                  </Link>
                  <Link
                    to="/sign-up"
                    onClick={() => setMobileOpen(false)}
                    className="h-10 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-black text-sm font-semibold flex items-center justify-center"
                  >
                    {t('landing.cta')}
                  </Link>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      {/* ── Main content ─────────────────────── */}
      <main>
        <Hero />

        <Suspense fallback={<SectionSkeleton />}>
          <Features />
        </Suspense>

        <Suspense fallback={<SectionSkeleton />}>
          <Pricing />
        </Suspense>

        <Suspense fallback={<SectionSkeleton />}>
          <Footer />
        </Suspense>
      </main>
    </div>
  );
}

/** Minimal skeleton placeholder for lazy sections */
function SectionSkeleton() {
  return (
    <div className="py-32 flex items-center justify-center" aria-hidden="true">
      <div className="w-6 h-6 border-2 border-border border-t-amber-500 rounded-full animate-spin" />
    </div>
  );
}

export default Landing;
