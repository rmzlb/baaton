import { useEffect, useState } from 'react';

/** Light/dark toggle shared by the public marketing pages (landing, compare). */
export function useLandingTheme() {
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.theme === 'dark';
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.theme = dark ? 'dark' : 'light';
  }, [dark]);
  return { dark, toggle: () => setDark(d => !d) };
}
