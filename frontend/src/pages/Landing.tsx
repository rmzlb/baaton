import { Link } from 'react-router-dom';
import { SignedIn, SignedOut } from '@clerk/clerk-react';
import { ArrowRight, Kanban, Robot, ShieldCheck } from '@phosphor-icons/react';
import { PixelBaton } from '@/components/shared/PixelBaton';

export function Landing() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#fafafa]">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-[#262626]">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-[#f59e0b] flex items-center justify-center text-black font-bold text-sm">
            B
          </div>
          <span className="text-lg font-semibold">baaton</span>
        </div>
        <div className="flex items-center gap-4">
          <SignedOut>
            <Link
              to="/sign-in"
              className="text-sm text-[#a1a1aa] hover:text-[#fafafa] transition-colors"
            >
              Sign in
            </Link>
            <Link
              to="/sign-up"
              className="rounded-full bg-[#f59e0b] px-4 py-2 text-sm font-medium text-black hover:bg-[#d97706] transition-colors"
            >
              Get started
            </Link>
          </SignedOut>
          <SignedIn>
            <Link
              to="/dashboard"
              className="rounded-full bg-[#f59e0b] px-4 py-2 text-sm font-medium text-black hover:bg-[#d97706] transition-colors"
            >
              Dashboard
            </Link>
          </SignedIn>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex flex-col items-center justify-center px-6 py-32 text-center">
        <div className="mb-8">
          <PixelBaton size={80} />
        </div>
        <p className="mb-4 text-xs uppercase tracking-[0.3em] text-[#f59e0b] font-mono">
          the orchestration board
        </p>
        <h1 className="max-w-3xl text-5xl font-bold leading-tight md:text-7xl">
          You orchestrate.
          <br />
          <span className="text-[#f59e0b]">AI executes.</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-[#a1a1aa]">
          Collect feedback from your team, clients, and users.
          Prioritize with precision. Let AI agents handle the rest.
          You hold the baton.
        </p>
        <div className="mt-10 flex gap-4">
          <Link
            to="/sign-up"
            className="flex items-center gap-2 rounded-full bg-[#f59e0b] px-6 py-3 text-sm font-medium text-black hover:bg-[#d97706] transition-colors"
          >
            Start orchestrating <ArrowRight size={16} />
          </Link>
          <a
            href="https://github.com/rmzlb/baaton"
            target="_blank"
            rel="noopener"
            className="flex items-center gap-2 rounded-full border border-[#262626] px-6 py-3 text-sm font-medium text-[#a1a1aa] hover:bg-[#141414] hover:text-[#fafafa] transition-colors"
          >
            GitHub
          </a>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-[#262626] px-6 py-24">
        <div className="mx-auto grid max-w-4xl gap-12 md:grid-cols-3">
          <div className="space-y-3">
            <Kanban size={32} className="text-[#f59e0b]" weight="duotone" />
            <h3 className="text-lg font-semibold">Collect & Organize</h3>
            <p className="text-sm text-[#a1a1aa]">
              Public forms, API, or direct input. Every bug, feature, and question
              lands in one place — qualified by AI, organized by you.
            </p>
          </div>
          <div className="space-y-3">
            <Robot size={32} className="text-[#f59e0b]" weight="duotone" />
            <h3 className="text-lg font-semibold">Agent-Ready API</h3>
            <p className="text-sm text-[#a1a1aa]">
              Claude Code, Codex, or your own agents connect via REST API.
              They read tickets, update status, and post what they did.
            </p>
          </div>
          <div className="space-y-3">
            <ShieldCheck size={32} className="text-[#f59e0b]" weight="duotone" />
            <h3 className="text-lg font-semibold">Human in the Loop</h3>
            <p className="text-sm text-[#a1a1aa]">
              You decide what ships. Review TLDRs, set priorities,
              approve or reject. The baton stays in your hand.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#262626] px-6 py-8 text-center text-xs text-[#a1a1aa]">
        <p>baaton.dev — You orchestrate. AI executes.</p>
      </footer>
    </div>
  );
}
