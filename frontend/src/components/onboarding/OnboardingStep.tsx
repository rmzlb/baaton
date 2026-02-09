import type { ReactNode } from 'react';
import { useTranslation } from '@/hooks/useTranslation';

interface OnboardingStepProps {
  children: ReactNode;
  currentIndex: number;
  totalSteps: number;
  onNext: () => void;
  onSkip: () => void;
  isLast: boolean;
}

export function OnboardingStepUI({
  children,
  currentIndex,
  totalSteps,
  onNext,
  onSkip,
  isLast,
}: OnboardingStepProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col h-full">
      {/* Step content */}
      <div className="flex-1 flex items-center justify-center px-6 py-8">
        {children}
      </div>

      {/* Footer: progress dots + buttons */}
      <div className="px-8 pb-8 pt-4 flex items-center justify-between border-t border-white/5">
        {/* Progress dots */}
        <div className="flex items-center gap-2">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === currentIndex
                  ? 'w-6 bg-amber-500'
                  : i < currentIndex
                    ? 'w-1.5 bg-amber-500/40'
                    : 'w-1.5 bg-white/10'
              }`}
            />
          ))}
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={onSkip}
            className="px-4 py-2 text-sm font-medium text-neutral-500 hover:text-white transition-colors"
          >
            Skip
          </button>
          <button
            onClick={onNext}
            className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-black text-sm font-bold rounded-lg transition-all shadow-[0_4px_0_0_#d97706] hover:shadow-[0_2px_0_0_#d97706] hover:translate-y-[2px] active:shadow-none active:translate-y-[4px] flex items-center gap-2"
          >
            {isLast ? t('onboarding.getStarted') : t('onboarding.continue')}
            {!isLast && (
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
                />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
