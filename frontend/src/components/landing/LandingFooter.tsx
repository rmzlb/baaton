import { Link } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';

export function LandingFooter() {
  const { t } = useTranslation();
  return (
    <footer className="py-12 border-t border-black/5 dark:border-white/5 bg-[#F3EFE7] dark:bg-[#080808] text-sm transition-colors z-20">
      <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
        <Link to="/" className="font-display text-2xl text-black dark:text-white uppercase tracking-wide">Baaton</Link>
        <div className="flex flex-wrap justify-center gap-x-8 gap-y-3 text-neutral-600 dark:text-neutral-500 font-bold uppercase tracking-wider text-xs">
          <Link to="/docs" className="hover:text-black dark:hover:text-white transition-colors">{t('landing.nav.docs')}</Link>
          <Link to="/docs#api-reference" className="hover:text-black dark:hover:text-white transition-colors">{t('landing.nav.api')}</Link>
          <Link to="/compare" className="hover:text-black dark:hover:text-white transition-colors">{t('landing.nav.methodology')}</Link>
          <a href="https://github.com/rmzlb/baaton" target="_blank" rel="noopener noreferrer" className="hover:text-black dark:hover:text-white transition-colors">GitHub</a>
          <a href="https://x.com/rmzlb" target="_blank" rel="noopener noreferrer" className="hover:text-black dark:hover:text-white transition-colors">Twitter</a>
        </div>
        <div className="text-neutral-500 font-medium">© 2026 Baaton Inc.</div>
      </div>
    </footer>
  );
}
