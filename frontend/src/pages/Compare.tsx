import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Moon, Sun, X } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useLandingTheme } from '@/hooks/useLandingTheme';
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher';
import { LandingFooter } from '@/components/landing/LandingFooter';

/** Comparison and limits, moved off the landing so a first visit reads the promise, not the caveats. */
export default function Compare() {
  const { dark, toggle } = useLandingTheme();
  const { t } = useTranslation();

  return (
    <div className={`min-h-[100dvh] ${dark ? 'bg-[#080808]' : 'bg-[#F3EFE7]'} transition-colors duration-500`}>
      <div className="noise" />

      <nav className="fixed top-0 w-full z-40 border-b border-black/5 dark:border-white/10 bg-[#F3EFE7]/90 dark:bg-[#080808]/90 backdrop-blur-md transition-colors duration-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link to="/" className="font-display text-2xl sm:text-4xl leading-none text-black dark:text-white uppercase tracking-wide relative">
              Baaton
              <div className="absolute -right-2 -top-1 w-2 h-2 bg-amber-500 rounded-full" />
            </Link>
            <Link to="/" className="hidden sm:flex items-center gap-1.5 text-sm font-semibold text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white transition-colors">
              <ArrowLeft className="w-4 h-4" /> {t('landing.comparePage.back')}
            </Link>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <button onClick={toggle} className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-neutral-900 dark:text-white transition-colors" aria-label="Toggle theme">
              {dark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <LanguageSwitcher variant="compact" />
            <Link to="/sign-up" className="hidden sm:flex px-5 py-2.5 bg-black dark:bg-white text-white dark:text-black text-sm font-bold rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all items-center gap-2">
              <span>{t('landing.cta')}</span>
              <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Against what you already use ── */}
      <section className="pt-32 sm:pt-44 pb-16 sm:pb-28 border-t border-black/5 dark:border-white/5 bg-[#F3EFE7] dark:bg-[#080808] transition-colors relative z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="mb-12 sm:mb-16 max-w-3xl">
            <p className="text-xs font-bold text-amber-500 uppercase tracking-widest mb-3">{t('landing.compare.badge')}</p>
            <h2 className="font-display text-4xl sm:text-5xl md:text-6xl text-black dark:text-white mb-6 uppercase tracking-tight">{t('landing.compare.title1')}<br />{t('landing.compare.title2')}</h2>
            <p className="text-lg text-neutral-600 dark:text-neutral-400 font-medium">{t('landing.compare.sub')}</p>
          </div>

          <div className="overflow-x-auto -mx-4 px-4">
            <div className="min-w-[700px] rounded-xl border border-black/10 dark:border-white/10 overflow-hidden bg-white dark:bg-[#0C0C0C]">
              {/* Header */}
              <div className="grid grid-cols-5 border-b border-black/5 dark:border-white/10 bg-neutral-50 dark:bg-neutral-900/40">
                <div className="p-4 text-xs font-bold text-neutral-500 uppercase tracking-wider">{t('landing.compare.capability')}</div>
                <div className="p-4 text-xs font-bold text-amber-500 uppercase tracking-wider text-center">Baaton</div>
                <div className="p-4 text-xs font-bold text-neutral-400 uppercase tracking-wider text-center">{t('landing.compare.whatsapp')}</div>
                <div className="p-4 text-xs font-bold text-neutral-400 uppercase tracking-wider text-center">Linear</div>
                <div className="p-4 text-xs font-bold text-neutral-400 uppercase tracking-wider text-center">Moxo</div>
              </div>
              {[
                [t('landing.compare.row.intake'), true, true, false, true],
                [t('landing.compare.row.retrieve'), true, false, true, true],
                [t('landing.compare.row.silo'), true, false, false, true],
                [t('landing.compare.row.agentwrite'), true, false, true, true],
                [t('landing.compare.row.attrib'), true, false, false, false],
                [t('landing.compare.row.revoke'), true, false, true, true],
                [t('landing.compare.row.solo'), true, true, true, false],
                [t('landing.compare.row.selfhost'), true, false, false, false],
              ].map(([label, ...vals], i) => (
                <div key={i} className={`grid grid-cols-5 border-b border-black/5 dark:border-white/5 last:border-0 ${i % 2 === 0 ? 'bg-white dark:bg-[#0C0C0C]' : 'bg-neutral-50/50 dark:bg-neutral-900/20'}`}>
                  <div className="p-4 text-sm font-semibold text-black dark:text-white">{label as string}</div>
                  {(vals as boolean[]).map((v, j) => (
                    <div key={j} className="p-4 flex items-center justify-center">
                      {v ? (
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center ${j === 0 ? 'bg-amber-500/15 text-amber-500' : 'bg-green-500/10 text-green-500'}`}>
                          <Check className="w-3.5 h-3.5" strokeWidth={3} />
                        </div>
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
                          <X className="w-3 h-3 text-neutral-400" strokeWidth={2} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <p className="mt-8 text-sm text-neutral-500 max-w-3xl">
            {t('landing.compare.note')}
          </p>
        </div>
      </section>

      {/* ── Limits, up front ── */}
      <section className="py-16 sm:py-28 border-t border-black/5 dark:border-white/5 bg-white dark:bg-[#060606] transition-colors relative z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl mb-10">
            <p className="text-xs font-bold text-amber-500 uppercase tracking-widest mb-3">{t('landing.not.badge')}</p>
            <h2 className="font-display text-4xl sm:text-5xl md:text-6xl text-black dark:text-white uppercase tracking-tight mb-4">{t('landing.not.title')}</h2>
            <p className="text-lg text-neutral-600 dark:text-neutral-400 font-medium">{t('landing.not.sub')}</p>
          </div>
          <div className="border-t border-black/10 dark:border-white/10">
            {[['landing.not.i1', 'landing.not.i1Desc'], ['landing.not.i2', 'landing.not.i2Desc'], ['landing.not.i3', 'landing.not.i3Desc'], ['landing.not.i4', 'landing.not.i4Desc']].map(([k, d]) => (
              <div key={k} className="grid grid-cols-1 md:grid-cols-[1fr_1.4fr] gap-2 md:gap-10 py-6 border-b border-black/10 dark:border-white/10">
                <div className="flex items-start gap-3">
                  <X className="w-4 h-4 text-neutral-400 flex-shrink-0 mt-1" strokeWidth={2.5} />
                  <p className="text-base font-semibold text-black dark:text-white leading-snug">{t(k)}</p>
                </div>
                <p className="text-[15px] text-neutral-600 dark:text-neutral-400 leading-relaxed md:pl-0 pl-7">{t(d)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-24 border-t border-black/5 dark:border-white/5 bg-[#F3EFE7] dark:bg-[#080808] transition-colors relative z-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="font-display text-4xl sm:text-5xl text-black dark:text-white uppercase tracking-tight mb-6">{t('landing.comparePage.ctaTitle')}</h2>
          <p className="text-lg text-neutral-600 dark:text-neutral-400 font-medium mb-10">{t('landing.ctaSub')}</p>
          <Link to="/sign-up" className="inline-flex h-14 px-10 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold text-lg items-center gap-2 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition-[transform,colors] duration-150">
            {t('landing.cta')} <ArrowRight className="w-5 h-5" strokeWidth={2.5} />
          </Link>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}
