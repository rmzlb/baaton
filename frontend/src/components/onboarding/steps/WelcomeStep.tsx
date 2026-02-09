import { Wand2, ArrowRight, Zap } from 'lucide-react';

export function WelcomeStep() {
  return (
    <div className="flex flex-col items-center text-center">
      {/* Icon cluster */}
      <div className="relative mb-8">
        <div className="w-20 h-20 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
          <Wand2 className="w-10 h-10 text-amber-500" strokeWidth={1.5} />
        </div>
        <div className="absolute -right-3 -top-3 w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center shadow-lg shadow-amber-500/30">
          <Zap className="w-4 h-4 text-black" strokeWidth={2.5} />
        </div>
      </div>

      <h2 className="font-display text-4xl uppercase tracking-tight text-white mb-3">
        Welcome to Baaton
      </h2>

      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 mb-6">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
        <span className="text-xs font-mono font-medium text-amber-500 uppercase tracking-widest">
          Orchestration Board
        </span>
      </div>

      <p className="text-lg text-neutral-400 max-w-md leading-relaxed mb-8 font-medium">
        The conductor's podium for engineering teams.
        <br />
        <span className="text-white font-semibold">You orchestrate. AI executes.</span>
      </p>

      <div className="flex items-center gap-4 text-sm text-neutral-500">
        <div className="flex items-center gap-2">
          <ArrowRight className="w-4 h-4 text-amber-500" />
          <span>Assign tickets to AI agents</span>
        </div>
        <div className="w-1 h-1 rounded-full bg-neutral-700" />
        <div className="flex items-center gap-2">
          <ArrowRight className="w-4 h-4 text-amber-500" />
          <span>Review &amp; merge faster</span>
        </div>
      </div>
    </div>
  );
}
