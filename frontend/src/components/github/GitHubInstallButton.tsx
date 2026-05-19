import { useState } from 'react';
import { GitFork as Github } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';

export function GitHubInstallButton() {
  const { t } = useTranslation();
  const api = useApi();
  const [pending, setPending] = useState(false);

  const handleClick = async () => {
    if (pending) return;
    setPending(true);
    try {
      const res = await api.github.startInstall();
      window.location.href = res.url;
    } catch (err) {
      console.error('[github] startInstall failed', err);
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black transition-[transform,colors] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-accent/90 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Github size={16} />
      {pending
        ? t('github.connecting', { defaultValue: 'Connecting…' })
        : t('github.connect')}
    </button>
  );
}
