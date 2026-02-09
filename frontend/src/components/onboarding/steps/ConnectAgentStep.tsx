import { Bot, Key, Terminal, Copy } from 'lucide-react';

export function ConnectAgentStep() {
  return (
    <div className="flex flex-col items-center text-center">
      {/* Icon */}
      <div className="relative mb-8">
        <div className="w-20 h-20 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
          <Bot className="w-10 h-10 text-amber-500" strokeWidth={1.5} />
        </div>
        <div className="absolute -left-3 -top-2 w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center shadow-lg shadow-amber-500/30">
          <Key className="w-4 h-4 text-black" strokeWidth={2.5} />
        </div>
      </div>

      <h2 className="font-display text-4xl uppercase tracking-tight text-white mb-3">
        Connect an Agent
      </h2>

      <p className="text-lg text-neutral-400 max-w-md leading-relaxed mb-8 font-medium">
        Generate an <span className="text-white">API key</span> and connect your favourite AI
        coding agent &mdash; Claude Code, Codex, or a custom one.
      </p>

      {/* Terminal mockup */}
      <div className="w-full max-w-sm rounded-xl border border-white/10 bg-[#0d0d0d] overflow-hidden text-left">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-[#FF5F56]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#27C93F]" />
          </div>
          <Terminal className="w-3.5 h-3.5 text-neutral-600 ml-2" />
          <span className="text-[10px] text-neutral-600 font-mono">terminal</span>
        </div>
        <div className="p-4 space-y-3 font-mono text-xs">
          <div className="flex items-start gap-2">
            <span className="text-amber-500 font-bold select-none">$</span>
            <span className="text-neutral-300">baaton agent connect</span>
          </div>
          <div className="text-neutral-500 pl-4">
            <div>✓ API key generated</div>
            <div>✓ Agent registered: claude-code-v1</div>
          </div>
          <div className="flex items-center gap-2 p-2 bg-white/5 rounded-lg border border-white/5">
            <Key className="w-3 h-3 text-amber-500 shrink-0" />
            <span className="text-neutral-400 truncate">baat_sk_••••••••••••••••</span>
            <Copy className="w-3 h-3 text-neutral-600 ml-auto shrink-0 cursor-pointer hover:text-white transition-colors" />
          </div>
          <div className="flex items-start gap-2">
            <span className="text-green-500 font-bold select-none">→</span>
            <span className="text-green-400">Agent ready. Assign your first ticket!</span>
          </div>
        </div>
      </div>
    </div>
  );
}
