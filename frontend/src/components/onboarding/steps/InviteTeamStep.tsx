import { Users, UserPlus, Shield, Mail } from 'lucide-react';

export function InviteTeamStep() {
  return (
    <div className="flex flex-col items-center text-center">
      {/* Icon */}
      <div className="relative mb-8">
        <div className="w-20 h-20 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
          <Users className="w-10 h-10 text-amber-500" strokeWidth={1.5} />
        </div>
        <div className="absolute -right-3 -bottom-2 w-8 h-8 rounded-lg bg-[#111] border border-white/10 flex items-center justify-center">
          <UserPlus className="w-4 h-4 text-white" strokeWidth={2} />
        </div>
      </div>

      <h2 className="font-display text-4xl uppercase tracking-tight text-white mb-3">
        Invite Your Team
      </h2>

      <p className="text-lg text-neutral-400 max-w-md leading-relaxed mb-8 font-medium">
        Collaborate with your team using{' '}
        <span className="text-white">organizations</span>. Share projects, review together, and ship
        as a unit.
      </p>

      {/* Team mockup */}
      <div className="w-full max-w-sm rounded-xl border border-white/10 bg-[#111] overflow-hidden">
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-bold text-neutral-400 uppercase tracking-wider">
              Team Members
            </span>
          </div>
          <span className="text-[10px] font-mono text-neutral-600 bg-white/5 px-2 py-0.5 rounded">
            3 / 5
          </span>
        </div>
        <div className="p-3 space-y-2">
          {[
            { name: 'You', role: 'Admin', active: true },
            { name: 'teammate@co.dev', role: 'Member', active: false },
          ].map((member) => (
            <div
              key={member.name}
              className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.03]"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-8 h-8 rounded-full ${
                    member.active
                      ? 'bg-amber-500 text-black'
                      : 'bg-neutral-800 text-neutral-500'
                  } flex items-center justify-center text-xs font-bold`}
                >
                  {member.name[0].toUpperCase()}
                </div>
                <div className="text-left">
                  <div className="text-sm text-white font-medium">{member.name}</div>
                  <div className="text-[10px] text-neutral-600">{member.role}</div>
                </div>
              </div>
              {member.active && (
                <span className="w-2 h-2 rounded-full bg-green-500" />
              )}
            </div>
          ))}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-white/10 text-neutral-500 cursor-pointer hover:text-amber-500 hover:border-amber-500/30 transition-colors">
            <Mail className="w-4 h-4" />
            <span className="text-sm font-medium">Invite via email</span>
          </div>
        </div>
      </div>
    </div>
  );
}
