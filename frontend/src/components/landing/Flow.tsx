import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';

/* Real board statuses and colors, as configured on the production projects. */
export const STATUS_COLOR = {
  draft: '#3b82f6',
  backlog: '#6b7280',
  progress: '#f59e0b',
  notOk: '#fa6400',
  review: '#8b5cf6',
  done: '#22c55e',
} as const;
export type StatusKey = keyof typeof STATUS_COLOR;

export const AGENTS = ['Claude Code', 'Codex', 'Cursor', 'OpenClaw'];

/** Status as mono text after a small colored square. */
export function StatusMark({ status }: { status: StatusKey }) {
  const { t } = useTranslation();
  return (
    <span className="st" style={{ '--c': STATUS_COLOR[status] } as React.CSSProperties}>
      <i />{t(`landing.status.${status}`)}
    </span>
  );
}

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/* ─── Hero: the promise, then one request followed through the real statuses ─── */
export function HeroFlow() {
  const { t, i18n } = useTranslation();
  const colon = i18n.language?.startsWith('fr') ? '\u00a0:' : ':';
  const flowRef = useRef<HTMLDivElement>(null);
  const [run, setRun] = useState(0);
  const replay = useCallback(() => setRun((n) => n + 1), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'r' || e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const top = flowRef.current?.getBoundingClientRect().top ?? 0;
      if (top < 0 || top > window.innerHeight) flowRef.current?.scrollIntoView({ block: 'start' });
      replay();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [replay]);

  return (
    <section className="hero-flow" id="hero">
      <div className="hero">
        <h1><span>{t('landing.hero.title1')}</span><span><em>{t('landing.hero.title2')}</em></span></h1>
        <div className="hero-row">
          <div>
            <p className="kicker">{t('landing.hero.kicker')}</p>
            <p className="lede">{t('landing.hero.sub')}</p>
          </div>
          <div className="hero-act">
            <div className="btns">
              <Link to="/sign-up" className="cta amber">{t('landing.cta')} <span aria-hidden="true">→</span></Link>
              <a className="ulink" href="#start">{t('landing.ctaSecondary')}</a>
            </div>
            <p className="agents">
              <span>{t('landing.socialProof')}{colon}</span>
              {[...AGENTS, t('landing.anyAgent')].map((a) => <b key={a}>{a}</b>)}
            </p>
          </div>
        </div>
      </div>

      <div className="flow" id="flow" ref={flowRef}>
        <div className="flow-head">
          <p><span className="mono">MAR-12 · {t('landing.flow.cardTitle')}</span><span className="ex">{t('landing.flow.example')}</span></p>
          <button className="kbd" type="button" onClick={replay} aria-keyshortcuts="R" title="R"><kbd>R</kbd> {t('landing.flow.replay')}</button>
        </div>
        <div className="lanes" key={run}>
          <div className="lane">
            <div className="lane-h"><span>01</span><StatusMark status="draft" /></div>
            <h3>{t('landing.flow.l1Title')}</h3>
            <p className="from">{t('landing.flow.l1From')}</p>
            <p className="ask">{t('landing.flow.l1Ask')}</p>
            <p className="arrow">↓ {t('landing.flow.l1Arrow')}</p>
            <p className="meta">{t('landing.flow.l1Meta')}</p>
            <dl>
              <dt>{t('landing.flow.l1Where')}</dt><dd>{t('landing.flow.l1WhereV')}</dd>
              <dt>{t('landing.flow.l1Now')}</dt><dd>{t('landing.flow.l1NowV')}</dd>
              <dt>{t('landing.flow.l1Want')}</dt><dd>{t('landing.flow.l1WantV')}</dd>
              <dt>{t('landing.flow.l1Check')}</dt><dd>☐ {t('landing.flow.l1CheckV')}</dd>
              <dt>{t('landing.flow.l1Att')}</dt><dd>{t('landing.flow.l1AttV')}</dd>
            </dl>
          </div>
          <div className="lane">
            <div className="lane-h"><span>02</span><span className="sts"><StatusMark status="backlog" /><StatusMark status="progress" /></span></div>
            <h3>{t('landing.flow.l2Title')}</h3>
            <p>{t('landing.flow.l2Body')}</p>
            <p className="hint">{t('landing.flow.l2HintHead')}<br /><b>pull_context</b> {t('landing.flow.l2Hint')}</p>
            <p className="arrow">{t('landing.flow.l2Meta')}</p>
          </div>
          <div className="lane">
            <div className="lane-h"><span>03</span><StatusMark status="review" /></div>
            <h3>{t('landing.flow.l3Title')}</h3>
            <div className="proof">
              <p><span>{t('landing.flow.l3Problem')}</span>{t('landing.flow.l3ProblemV')}</p>
              <p><span>{t('landing.flow.l3Cause')}</span>{t('landing.flow.l3CauseV')}</p>
              <p><span>{t('landing.flow.l3Fix')}</span>{t('landing.flow.l3FixV')}</p>
            </div>
            <p className="checks"><span>✓ {t('landing.flow.l3Tests')}</span><span>✓ {t('landing.flow.l3Shot')}</span></p>
          </div>
          <div className="lane">
            <div className="lane-h"><span>04</span><span className="sts"><StatusMark status="done" /><StatusMark status="notOk" /></span></div>
            <h3 className="you">{t('landing.flow.l4Title')}</h3>
            <p>{t('landing.flow.l4Body')}</p>
            <div className="verdict"><StatusMark status="done" /><p>{t('landing.flow.l4Ok')}<small>{t('landing.flow.l4OkNote')}</small></p></div>
            <div className="verdict"><StatusMark status="notOk" /><p>{t('landing.flow.l4Nok')}<small>{t('landing.flow.l4NokNote')}</small></p></div>
          </div>
        </div>
        <div className="times">
          {(['1', '2', '3', '4'] as const).map((i) => (
            <p key={i}><b>{t(`landing.flow.tv${i}`)}</b>{t(`landing.flow.t${i}`)}</p>
          ))}
        </div>
        <div className="flow-foot"><span>{t('landing.flow.timesHead')}</span><span>{t('landing.flow.return')} ↺</span></div>
        <p className="hero-name">{t('landing.heroName')}</p>
      </div>
    </section>
  );
}

/* ─── Every open ticket of one client, filterable by real status ─── */
const BOARD: { status: StatusKey; id: string; note: string; titleKey: string; current?: boolean }[] = [
  { status: 'draft', id: 'MAR-14', note: 'landing.board.typeFeature', titleKey: 'landing.board.c1' },
  { status: 'backlog', id: 'MAR-13', note: 'landing.board.typeBug', titleKey: 'landing.board.c2' },
  { status: 'progress', id: 'MAR-11', note: 'landing.board.c3Note', titleKey: 'landing.board.c3' },
  { status: 'review', id: 'MAR-12', note: 'landing.board.c5Note', titleKey: 'landing.flow.cardTitle', current: true },
  { status: 'notOk', id: 'MAR-9', note: 'landing.board.c4Note', titleKey: 'landing.board.c4' },
  { status: 'done', id: 'MAR-8', note: 'landing.board.closed', titleKey: 'landing.board.c6' },
];
const FILTERS: ('all' | StatusKey)[] = ['all', 'draft', 'backlog', 'progress', 'review', 'notOk', 'done'];

export function LiveBoard() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<'all' | StatusKey>('all');
  return (
    <>
      <div className="tabs">
        <div className="t" role="tablist" aria-label={t('landing.board.caption')}>
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              className={filter === f ? 'on' : undefined}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? t('landing.board.all') : t(`landing.status.${f}`)}
            </button>
          ))}
        </div>
      </div>
      <ul className="rows tickets">
        {BOARD.filter((c) => filter === 'all' || c.status === filter).map((c) => (
          <li key={c.id} className={`row${c.current ? ' cur' : ''}`}>
            <span className="l">{c.id}</span>
            <div><div className="t">{t(c.titleKey)}</div><div className="m">{t(c.note)}</div></div>
            <span className="r"><StatusMark status={c.status} /></span>
          </li>
        ))}
      </ul>
      <div className="more"><span>{t('landing.board.caption')}</span><span className="ex">{t('landing.flow.example')}</span></div>
    </>
  );
}

/* ─── One line to connect, then plain requests ─── */
export function AgentTerminal() {
  const { t } = useTranslation();
  const lines: { key: string; tone: 'u' | 'o' | 'h' }[] = [
    { key: 'u1', tone: 'u' }, { key: 'o1', tone: 'o' }, { key: 'h1', tone: 'h' }, { key: 'o2', tone: 'o' },
    { key: 'u2', tone: 'u' }, { key: 'o3', tone: 'o' },
  ];
  return (
    <div className="term">
      <div className="tbar"><span>{AGENTS.join(' · ')}</span><span>MAR-12</span></div>
      <pre>
        {lines.map((l, i) => (
          <span key={l.key} className={l.tone}>{l.tone === 'h' ? '  ' : ''}{t(`landing.agentUse.${l.key}`)}{i < lines.length - 1 ? '\n' : ''}</span>
        ))}
      </pre>
    </div>
  );
}
