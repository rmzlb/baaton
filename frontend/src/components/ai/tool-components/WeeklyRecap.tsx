import { CheckCircle2, Plus, AlertTriangle, Trophy } from 'lucide-react';

interface WeeklyRecapData {
  period?: string;
  completed_count?: number;
  new_count?: number;
  blockers?: string[];
  top_contributor?: string;
  highlights?: string[];
}

interface WeeklyRecapProps {
  data: WeeklyRecapData | WeeklyRecapData[];
}

export default function WeeklyRecap({ data }: WeeklyRecapProps) {
  const recap: WeeklyRecapData = Array.isArray(data) ? (data[0] ?? {}) : data;

  return (
    <div className="rounded-lg border border-[--color-border] bg-[--color-surface] p-4 space-y-3">
      {recap.period && (
        <p className="text-[10px] uppercase tracking-wide text-[--color-muted]">{recap.period}</p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center gap-2 rounded-md bg-emerald-400/10 px-3 py-2">
          <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
          <div>
            <span className="text-2xl font-bold text-emerald-400">{recap.completed_count ?? '—'}</span>
            <p className="text-[10px] text-[--color-muted]">Completed</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-md bg-blue-400/10 px-3 py-2">
          <Plus size={16} className="text-blue-400 shrink-0" />
          <div>
            <span className="text-2xl font-bold text-blue-400">{recap.new_count ?? '—'}</span>
            <p className="text-[10px] text-[--color-muted]">New Issues</p>
          </div>
        </div>
      </div>

      {recap.blockers && recap.blockers.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-amber-400">
            <AlertTriangle size={10} />
            Blockers
          </div>
          <ul className="space-y-1">
            {recap.blockers.map((b, i) => (
              <li key={i} className="text-xs text-[--color-secondary] flex items-start gap-1.5">
                <span className="text-amber-400 mt-0.5">·</span>
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}

      {recap.highlights && recap.highlights.length > 0 && (
        <ul className="space-y-1">
          {recap.highlights.map((h, i) => (
            <li key={i} className="text-xs text-[--color-secondary] flex items-start gap-1.5">
              <span className="text-emerald-400 mt-0.5">✓</span>
              {h}
            </li>
          ))}
        </ul>
      )}

      {recap.top_contributor && (
        <div className="flex items-center gap-2 border-t border-[--color-border] pt-2 text-xs">
          <Trophy size={12} className="text-[--color-accent]" />
          <span className="text-[--color-muted]">Top contributor:</span>
          <span className="font-medium text-[--color-primary]">{recap.top_contributor}</span>
        </div>
      )}
    </div>
  );
}
