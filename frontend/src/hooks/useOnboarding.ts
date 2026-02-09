import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { createOnboardingTour } from '@/lib/onboarding';

const STORAGE_KEY = 'baaton_onboarding_complete';

export function useOnboarding() {
  const { t } = useTranslation();
  const [isFirstTime, setIsFirstTime] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) !== 'true';
  });
  const tourStartedRef = useRef(false);

  const markComplete = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setIsFirstTime(false);
  }, []);

  const startTour = useCallback(() => {
    const tourDriver = createOnboardingTour(t, markComplete);
    tourDriver.drive();
  }, [t, markComplete]);

  const resetTour = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setIsFirstTime(true);
  }, []);

  // Auto-start tour on first visit (with small delay for layout to settle)
  useEffect(() => {
    if (isFirstTime && !tourStartedRef.current) {
      tourStartedRef.current = true;
      const timer = setTimeout(() => {
        startTour();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isFirstTime, startTour]);

  return { startTour, isFirstTime, resetTour };
}
