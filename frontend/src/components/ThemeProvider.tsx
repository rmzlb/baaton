import { useEffect } from 'react';
import { useUIStore } from '@/stores/ui';

/**
 * Syncs the Zustand theme state to the <html> class.
 * Renders nothing — just a side-effect component.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useUIStore((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.remove('dark');
      root.style.colorScheme = 'light';
    }
  }, [theme]);

  return <>{children}</>;
}
