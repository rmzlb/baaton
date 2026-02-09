import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface Props {
  /** Compact: just flags. Full: flags + labels */
  variant?: 'compact' | 'full';
  className?: string;
}

const LANGUAGES = [
  { code: 'en', flag: '🇬🇧', label: 'EN' },
  { code: 'fr', flag: '🇫🇷', label: 'FR' },
] as const;

export function LanguageSwitcher({ variant = 'compact', className }: Props) {
  const { i18n } = useTranslation();
  const currentLang = i18n.language?.startsWith('fr') ? 'fr' : 'en';

  const handleChange = (lang: string) => {
    i18n.changeLanguage(lang);
  };

  return (
    <div className={cn('flex items-center gap-1', className)} role="radiogroup" aria-label="Language">
      {LANGUAGES.map(({ code, flag, label }) => (
        <button
          key={code}
          onClick={() => handleChange(code)}
          role="radio"
          aria-checked={currentLang === code}
          aria-label={`Switch to ${label}`}
          className={cn(
            'flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-all',
            currentLang === code
              ? 'bg-accent/15 text-accent'
              : 'text-muted hover:text-secondary hover:bg-surface-hover',
          )}
        >
          <span className="text-sm">{flag}</span>
          {variant === 'full' && <span>{label}</span>}
        </button>
      ))}
    </div>
  );
}
