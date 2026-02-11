import { Github } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

import { resolveApiOrigin } from '@/lib/api-origin';

const API_BASE = `${resolveApiOrigin()}/api/v1`;

export function GitHubInstallButton() {
  const { t } = useTranslation();

  return (
    <a
      href={`${API_BASE}/github/install`}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-black text-sm font-semibold hover:bg-accent/90 transition-colors"
    >
      <Github size={16} />
      {t('github.connect')}
    </a>
  );
}
