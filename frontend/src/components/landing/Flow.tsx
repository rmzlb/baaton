import { Link } from 'react-router-dom';
import { ArrowRight, Terminal } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

/* Real board statuses and colors, as configured on the production projects. */
const STATUS_COLOR = {
  draft: '#3b82f6',
  backlog: '#6b7280',
  progress: '#f59e0b',
  notOk: '#fa6400',
  review: '#8b5cf6',
  done: '#22c55e',
} as const;
type StatusKey = keyof typeof STATUS_COLOR;

const AGENTS = ['Claude Code', 'Codex', 'Cursor', 'OpenClaw'];

const card = 'rounded-[10px] bg-white dark:bg-[#111] border border-black/5 dark:border-white/10 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] p-4 text-[13.5px] leading-normal text-neutral-600 dark:text-neutral-400';
const meta = 'block mt-2.5 font-mono text-[11px] text-neutral-500';
const tag = 'font-mono text-[10.5px] font-semibold uppercase px-1.5 py-0.5 rounded';

function StatusPill({ status }: { status: StatusKey }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold text-black dark:text-white bg-white dark:bg-neutral-900 border border-black/10 dark:border-white/10 px-2 py-0.5 rounded-full whitespace-nowrap">
      <span className="w-[7px] h-[7px] rounded-full" style={{ background: STATUS_COLOR[status] }} />
      {t(`landing.status.${status}`)}
    </span>
  );
}

function Lane({ n, statuses, title, you, children }: { n: string; statuses: StatusKey[]; title: string; you?: boolean; children: React.ReactNode }) {
  return (
    <div className="py-5 lg:pt-4 lg:pb-6 lg:px-5 lg:first:pl-0 lg:last:pr-0 border-black/15 dark:border-white/15 [&:not(:first-child)]:border-t lg:[&:not(:first-child)]:border-t-0 lg:[&:not(:first-child)]:border-l">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-medium text-black dark:text-white">{n}</span>
        <span className="flex gap-1.5">{statuses.map((s) => <StatusPill key={s} status={s} />)}</span>
      </div>
      <h3 className={`font-display text-4xl uppercase leading-[1.18] mt-3 mb-4 whitespace-pre-line ${you ? 'text-amber-600 dark:text-amber-500' : 'text-black dark:text-white'}`}>{title}</h3>
      <div className={card}>{children}</div>
    </div>
  );
}

function TicketField({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="font-mono text-[10.5px] text-neutral-500 pt-px">{label}</dt>
      <dd className="text-black dark:text-neutral-200">{value}</dd>
    </>
  );
}

function Proof({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="block font-mono text-[10.5px] font-semibold uppercase tracking-wide text-neutral-500">{label}</span>
      <span className="text-black dark:text-neutral-200">{value}</span>
    </p>
  );
}

/* ─── Hero: the promise, then one request followed through the real statuses ─── */
export function HeroFlow() {
  const { t } = useTranslation();
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 relative z-10">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-14 lg:items-end pb-10 sm:pb-12">
        <div className="opacity-0 animate-reveal-up-delay">
          <p className="font-mono text-xs uppercase tracking-[0.06em] font-medium text-amber-700 dark:text-amber-500">{t('landing.hero.kicker')}</p>
          <h1 className="font-display text-[11.5vw] sm:text-6xl lg:text-[4.75rem] leading-[1.04] text-black dark:text-white mt-4">
            {t('landing.hero.title1')}<br />
            <span className="text-amber-600 dark:text-amber-500">{t('landing.hero.title2')}</span>
          </h1>
        </div>
        <div className="opacity-0 animate-reveal-up-delay-2">
          <p className="text-lg text-neutral-600 dark:text-neutral-400 leading-relaxed font-medium">{t('landing.hero.sub')}</p>
          <div className="flex flex-col sm:flex-row gap-3 mt-7">
            <Link to="/sign-up" className="h-14 px-7 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold text-[17px] transition-all shadow-[0_4px_0_0_#d97706] hover:shadow-[0_2px_0_0_#d97706] hover:translate-y-[2px] active:shadow-none active:translate-y-[4px] flex items-center gap-2 justify-center whitespace-nowrap">
              {t('landing.cta')} <ArrowRight className="w-5 h-5" strokeWidth={2.5} />
            </Link>
            <a href="#start" className="h-14 px-6 rounded-lg bg-white dark:bg-neutral-900 border border-black/10 dark:border-white/10 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-black dark:text-white font-semibold text-[15px] transition-all flex items-center gap-2 justify-center whitespace-nowrap shadow-[0_4px_0_0_rgba(0,0,0,0.1)] hover:shadow-[0_2px_0_0_rgba(0,0,0,0.1)] hover:translate-y-[2px] active:shadow-none active:translate-y-[4px] dark:shadow-[0_4px_0_0_rgba(255,255,255,0.1)]">
              <Terminal className="w-4 h-4" /> {t('landing.ctaSecondary')}
            </a>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 border-t-2 border-black dark:border-white opacity-0 animate-fade-in-delay">
        <Lane n="01" statuses={['draft']} title={t('landing.flow.l1Title')}>
          <div className="bg-neutral-100 dark:bg-neutral-900 rounded-[10px_10px_10px_2px] px-3 py-2.5 font-semibold text-black dark:text-white">
            <span className="block font-mono text-[10.5px] font-medium text-neutral-500 mb-1">{t('landing.flow.l1From')}</span>
            {t('landing.flow.l1Ask')}
          </div>
          <p className="text-[12.5px] text-neutral-500 mt-2.5 mb-2">↓ {t('landing.flow.l1Arrow')}</p>
          <div className="border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-[12.5px] leading-snug">
            <p className="font-mono text-[10.5px] text-neutral-500 mb-1.5">{t('landing.flow.l1Meta')}</p>
            <dl className="grid grid-cols-[78px_1fr] gap-x-2 gap-y-1">
              <TicketField label={t('landing.flow.l1Where')} value={t('landing.flow.l1WhereV')} />
              <TicketField label={t('landing.flow.l1Now')} value={t('landing.flow.l1NowV')} />
              <TicketField label={t('landing.flow.l1Want')} value={t('landing.flow.l1WantV')} />
              <TicketField label={t('landing.flow.l1Check')} value={`☐ ${t('landing.flow.l1CheckV')}`} />
              <TicketField label={t('landing.flow.l1Att')} value={t('landing.flow.l1AttV')} />
            </dl>
          </div>
        </Lane>
        <Lane n="02" statuses={['backlog', 'progress']} title={t('landing.flow.l2Title')}>
          <p>{t('landing.flow.l2Body')}</p>
          <p className="mt-2.5 rounded-md bg-[#1a1a1a] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-emerald-300">
            {t('landing.flow.l2HintHead')}<br /><span className="text-amber-400">pull_context</span> {t('landing.flow.l2Hint')}
          </p>
          <span className={meta}>{t('landing.flow.l2Meta')}</span>
        </Lane>
        <Lane n="03" statuses={['review']} title={t('landing.flow.l3Title')}>
          <div className="grid gap-1.5 text-[12.5px] leading-snug">
            <Proof label={t('landing.flow.l3Problem')} value={t('landing.flow.l3ProblemV')} />
            <Proof label={t('landing.flow.l3Cause')} value={t('landing.flow.l3CauseV')} />
            <Proof label={t('landing.flow.l3Fix')} value={t('landing.flow.l3FixV')} />
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            <span className={`${tag} bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400`}>{t('landing.flow.l3Tests')}</span>
            <span className={`${tag} bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400`}>{t('landing.flow.l3Shot')}</span>
          </div>
        </Lane>
        <Lane n="04" statuses={['done', 'notOk']} title={t('landing.flow.l4Title')} you>
          <p>{t('landing.flow.l4Body')}</p>
          <div className="grid gap-2 mt-2.5 text-[12.5px] text-black dark:text-neutral-200">
            <div className="grid grid-cols-[auto_1fr] gap-2 items-start">
              <StatusPill status="done" />
              <p>{t('landing.flow.l4Ok')}<span className="block text-[11.5px] text-neutral-500">{t('landing.flow.l4OkNote')}</span></p>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-2 items-start">
              <StatusPill status="notOk" />
              <p>{t('landing.flow.l4Nok')}<span className="block text-[11.5px] text-neutral-500">{t('landing.flow.l4NokNote')}</span></p>
            </div>
          </div>
        </Lane>
      </div>

      {/* The relay track: the ticket is the baton, carried by the tanuki */}
      <div className="relative h-[140px] rounded bg-[#121211] dark:ring-1 dark:ring-white/10 overflow-hidden opacity-0 animate-fade-in-delay" aria-hidden="true">
        <div className="absolute inset-0 bg-[repeating-linear-gradient(to_bottom,transparent_0_27px,rgba(243,239,231,0.14)_27px_28px)]" />
        {['25%', '50%', '75%'].map((left) => (
          <div key={left} className="hidden lg:block absolute inset-y-0 w-[92px] -ml-[46px] border-x-2 border-dashed border-amber-500/65 bg-amber-500/[0.07]" style={{ left }}>
            <span className="absolute top-[7px] left-1/2 -translate-x-1/2 font-mono text-[9.5px] tracking-[0.08em] uppercase text-amber-500 whitespace-nowrap">{t('landing.flow.handoff')}</span>
          </div>
        ))}
        <div className="absolute top-[22px] left-4 lg:left-[calc(75%-250px)] flex items-center gap-2.5 z-10">
          <img src="/favicon.svg" alt="" className="w-12 h-12 [image-rendering:pixelated]" />
          <div className="w-[250px] sm:w-[270px] grid grid-cols-[5px_1fr] gap-2.5 bg-white rounded-md px-3 py-2 shadow-[0_10px_24px_-8px_rgba(0,0,0,0.6)]">
            <i className="bg-amber-500 rounded-sm" />
            <div>
              <p className="flex justify-between font-mono text-[10.5px] text-neutral-500"><span>MAR-12</span><span>{t('landing.flow.cardStatus')}</span></p>
              <p className="text-[13px] font-bold leading-snug text-black mt-0.5">{t('landing.flow.cardTitle')}</p>
            </div>
          </div>
        </div>
        <div className="absolute left-[8%] right-[8%] lg:left-[37.5%] lg:right-[12.5%] bottom-6 h-[22px]">
          <svg className="absolute inset-0 w-full h-full overflow-visible" viewBox="0 0 100 22" preserveAspectRatio="none">
            <path d="M100 4 V14 H1" fill="none" stroke="#fa6400" strokeWidth="2" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
            <path d="M0 14 L6 9 M0 14 L6 19" stroke="#fa6400" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
          <span className="absolute left-1/2 -bottom-3.5 -translate-x-1/2 font-mono text-[10px] tracking-[0.06em] uppercase text-[#fa6400] whitespace-nowrap bg-[#121211] px-1.5">{t('landing.flow.return')}</span>
        </div>
      </div>

      <div className="flex justify-between gap-4 pt-3.5 font-mono text-[11.5px] uppercase tracking-[0.06em] text-neutral-500">
        <span>{t('landing.flow.timesHead')}</span><span>{t('landing.flow.example')}</span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 border-b border-black/15 dark:border-white/15">
        {(['1', '2', '3', '4'] as const).map((i) => (
          <p key={i} className="py-3 pr-4 lg:pr-5 text-[13px] font-medium text-neutral-600 dark:text-neutral-400">
            <b className="font-mono text-lg font-semibold text-black dark:text-white mr-1.5">{t(`landing.flow.tv${i}`)}</b>{t(`landing.flow.t${i}`)}
          </p>
        ))}
      </div>

      <p className="mt-7 max-w-2xl border-l-[3px] border-amber-500 pl-4 text-[17px] font-semibold leading-relaxed text-neutral-600 dark:text-neutral-300">{t('landing.heroName')}</p>

      <div className="mt-7 flex flex-wrap items-center gap-2 text-[13px] text-neutral-500">
        <span className="mr-1">{t('landing.socialProof')} :</span>
        {[...AGENTS, t('landing.anyAgent')].map((a) => (
          <span key={a} className="font-semibold text-neutral-600 dark:text-neutral-300 bg-white dark:bg-neutral-900 border border-black/5 dark:border-white/10 px-2.5 py-1 rounded-full">{a}</span>
        ))}
      </div>
    </div>
  );
}

/* ─── Every open ticket of one client, in the real columns ─── */
const BOARD: { status: StatusKey; count: number; id: string; note: string; titleKey: string; hot?: boolean; current?: boolean }[] = [
  { status: 'draft', count: 2, id: 'MAR-14', note: 'landing.board.typeFeature', titleKey: 'landing.board.c1' },
  { status: 'backlog', count: 3, id: 'MAR-13', note: 'landing.board.typeBug', titleKey: 'landing.board.c2' },
  { status: 'progress', count: 2, id: 'MAR-11', note: 'landing.board.c3Note', titleKey: 'landing.board.c3' },
  { status: 'notOk', count: 1, id: 'MAR-9', note: 'landing.board.c4Note', titleKey: 'landing.board.c4', hot: true },
  { status: 'review', count: 3, id: 'MAR-12', note: 'landing.board.c5Note', titleKey: 'landing.flow.cardTitle', current: true },
  { status: 'done', count: 41, id: 'MAR-8', note: 'landing.board.closed', titleKey: 'landing.board.c6' },
];

export function LiveBoard() {
  const { t } = useTranslation();
  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-14 lg:items-end mb-9">
        <div>
          <p className="text-xs font-bold text-amber-500 uppercase tracking-widest mb-3">{t('landing.demo.badge')}</p>
          <h2 className="font-display text-4xl sm:text-5xl leading-[1.2] uppercase text-black dark:text-white">{t('landing.board.title1')}<br />{t('landing.board.title2')}</h2>
        </div>
        <p className="text-lg text-neutral-600 dark:text-neutral-400 font-medium leading-relaxed">{t('landing.board.sub')}</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 rounded-xl border border-black/5 dark:border-white/10 bg-white dark:bg-[#0C0C0C] p-3">
        {BOARD.map((c) => (
          <div key={c.status} className="flex flex-col gap-2">
            <p className="flex items-center justify-between px-1 pt-1 pb-1.5 font-display text-[17px] uppercase text-black dark:text-white">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLOR[c.status] }} />{t(`landing.status.${c.status}`)}</span>
              <span className="font-mono text-[11px] font-semibold bg-neutral-100 dark:bg-neutral-800 px-1.5 rounded tabular-nums">{c.count}</span>
            </p>
            <div className={`rounded-lg bg-[#FAFAFA] dark:bg-[#151515] p-2.5 text-[12.5px] font-semibold leading-snug text-black dark:text-neutral-200 ${c.current ? 'border-2 border-amber-500' : c.hot ? 'border border-[#fa6400]' : 'border border-black/5 dark:border-white/10'}`}>
              <span className="flex justify-between gap-2 font-mono text-[10px] font-medium text-neutral-500 mb-1"><b className="font-semibold text-neutral-600 dark:text-neutral-400">{c.id}</b><span className="truncate">{t(c.note)}</span></span>
              {t(c.titleKey)}
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-between gap-4 pt-3.5 font-mono text-[11.5px] uppercase tracking-[0.06em] text-neutral-500">
        <span>{t('landing.board.caption')}</span><span>{t('landing.flow.example')}</span>
      </div>
    </>
  );
}

/* ─── One line to connect, then plain requests ─── */
export function AgentTerminal() {
  const { t } = useTranslation();
  const lines: { key: string; tone: 'u' | 'ok' | 'hint' }[] = [
    { key: 'u1', tone: 'u' }, { key: 'o1', tone: 'ok' }, { key: 'h1', tone: 'hint' }, { key: 'o2', tone: 'ok' },
    { key: 'u2', tone: 'u' }, { key: 'o3', tone: 'ok' },
  ];
  const tone = { u: 'text-white', ok: 'text-emerald-300', hint: 'text-amber-400 pl-4' };
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center">
      <div>
        <h3 className="font-display text-3xl sm:text-[2.5rem] leading-[1.2] uppercase text-black dark:text-white">{t('landing.agentUse.title1')}<br />{t('landing.agentUse.title2')}</h3>
        <p className="text-lg text-neutral-600 dark:text-neutral-400 font-medium leading-relaxed mt-4">{t('landing.agentUse.sub')}</p>
      </div>
      <div className="rounded-xl bg-[#1a1a1a] overflow-hidden shadow-[0_24px_48px_-24px_rgba(0,0,0,0.45)] border border-black/10 dark:border-white/10">
        <p className="px-4 py-2.5 border-b border-white/10 font-mono text-[11px] uppercase tracking-[0.08em] text-neutral-500">{AGENTS.join(' · ')}</p>
        <div className="px-4 sm:px-5 py-4 font-mono text-[12.5px] sm:text-[13px] leading-[1.75]">
          {lines.map((l) => <p key={l.key} className={tone[l.tone]}>{t(`landing.agentUse.${l.key}`)}</p>)}
        </div>
      </div>
    </div>
  );
}
