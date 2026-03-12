import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { Mail, Copy, Check, ExternalLink } from 'lucide-react';
import { resolveApiOrigin } from '@/lib/api-origin';

export function EmailIntakeSection({ projectSlug }: { projectSlug: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const apiBase = resolveApiOrigin();
  const endpoint = `${apiBase}/api/v1/public/${projectSlug}/email-intake`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-primary flex items-center gap-2">
          <Mail size={15} className="text-accent" />
          {t('emailIntake.title')}
        </h3>
        <p className="text-xs text-secondary mt-0.5">{t('emailIntake.subtitle')}</p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
        <p className="text-sm text-secondary leading-relaxed">
          {t('emailIntake.description')}
        </p>

        <div>
          <label className="block text-xs font-medium text-secondary mb-2">
            {t('emailIntake.endpoint')}
          </label>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2">
            <code className="flex-1 text-xs font-mono text-accent truncate">{endpoint}</code>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-secondary hover:text-primary hover:bg-surface-hover transition-colors shrink-0"
            >
              {copied ? (
                <>
                  <Check size={12} className="text-green-400" />
                  <span className="text-green-400">{t('emailIntake.copied')}</span>
                </>
              ) : (
                <>
                  <Copy size={12} />
                  {t('emailIntake.copy')}
                </>
              )}
            </button>
          </div>
        </div>

        <div className="rounded-lg bg-surface-hover border border-border/50 p-3">
          <p className="text-xs text-muted flex items-start gap-2">
            <ExternalLink size={12} className="mt-0.5 shrink-0 text-accent" />
            {t('emailIntake.hint')}
          </p>
        </div>
      </div>
    </div>
  );
}
