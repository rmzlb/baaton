import { Link } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import '@/components/landing/landing.css';

const CLUSTERS = [
  { left: '9%', top: '22%', width: 90, height: 110 },
  { left: '72%', top: '58%', width: 170, height: 90 },
  { left: '28%', top: '70%', width: 40, height: 40 },
  { left: '84%', top: '16%', width: 34, height: 34 },
];

/** Public footer (landing, compare): columns, then a pixel field with the floating tanuki. */
export function LandingFooter() {
  const { t } = useTranslation();
  return (
    <footer className="lp-foot">
      <div className="in">
        <div className="fgrid">
          <div>
            <Link to="/" className="fbrand">baaton<b>.</b>dev</Link>
            <div className="fsmall">
              © 2026 Baaton<br />
              <Link to="/privacy">{t('landing.footer.privacy')}</Link>
              <Link to="/terms">{t('landing.footer.terms')}</Link>
              <a href="https://x.com/rmzlb" target="_blank" rel="noopener noreferrer">X</a>
            </div>
          </div>
          <div className="fcol">
            <h4>{t('landing.footer.product')}</h4>
            <a href="/#how-it-works">{t('landing.nav.features')}</a>
            <Link to="/compare">{t('landing.nav.methodology')}</Link>
            <a href="/#pricing">{t('landing.nav.pricing')}</a>
            <Link to="/docs">{t('landing.nav.docs')}</Link>
            <Link to="/docs#api-reference">{t('landing.nav.api')}</Link>
          </div>
          <div className="fcol">
            <h4>{t('landing.footer.agents')}</h4>
            <Link to="/docs#agent-skill">Claude Code</Link>
            <Link to="/docs#agent-quickstart">Codex</Link>
            <Link to="/docs#agent-quickstart">Cursor</Link>
            <Link to="/docs#openclaw">OpenClaw</Link>
            <a href="https://github.com/rmzlb/baaton" target="_blank" rel="noopener noreferrer">GitHub</a>
          </div>
          <div className="fcol">
            <h4>{t('landing.ctaBadge')}</h4>
            <p>{t('landing.footer.pitch')}</p>
            <Link to="/sign-up" className="cta">{t('landing.cta')} <span aria-hidden="true">→</span></Link>
            <div className="note">{t('landing.footer.freeNote')}</div>
          </div>
        </div>
        <div className="field" aria-hidden="true">
          {CLUSTERS.map((c) => <div key={c.left} className="cluster" style={c} />)}
          <div className="mascot"><img src="/favicon.svg" alt="" /><span className="chip">MAR-12 → {t('landing.status.done')}</span></div>
        </div>
      </div>
    </footer>
  );
}
