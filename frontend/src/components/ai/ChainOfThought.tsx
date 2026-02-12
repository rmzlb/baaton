import { CheckCircle2, Circle, Clock, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ChainStep = {
  label: string;
  detail?: string;
  status?: 'done' | 'pending' | 'waiting';
};

export function ChainOfThought({
  title = 'Analyse',
  steps,
}: {
  title?: string;
  steps: ChainStep[];
}) {
  return (
    <details className="rounded-lg border border-border/60 bg-surface/70 px-3 py-2">
      <summary className="flex items-center gap-2 cursor-pointer text-[11px] text-secondary">
        <ChevronDown size={12} className="text-muted" />
        <span className="font-medium">{title}</span>
      </summary>
      <div className="mt-2 space-y-2">
        {steps.map((step, idx) => {
          const icon = step.status === 'done'
            ? <CheckCircle2 size={12} className="text-emerald-400" />
            : step.status === 'waiting'
              ? <Clock size={12} className="text-amber-400" />
              : <Circle size={12} className="text-muted" />;
          return (
            <div key={`${step.label}-${idx}`} className="flex items-start gap-2 text-[10px] text-muted">
              <div className="mt-0.5">{icon}</div>
              <div className={cn('flex-1', step.detail && 'space-y-0.5')}>
                <div className="text-[11px] text-secondary">{step.label}</div>
                {step.detail && <div>{step.detail}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}
