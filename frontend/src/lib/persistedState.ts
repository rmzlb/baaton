import { useEffect, useRef, useState } from 'react';

/**
 * useState backed by localStorage.
 *
 * Views (all-issues, my-tasks, dashboard table) are daily-driver screens:
 * re-picking sort, filters and tabs on every visit is pure friction. Anything
 * the user explicitly chose should survive a reload.
 *
 * `validate` guards against stale shapes written by an older build — a bad
 * value falls back to the default instead of crashing the page.
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T,
  validate?: (value: unknown) => T | null,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return defaultValue;
      const parsed = JSON.parse(raw) as unknown;
      if (validate) return validate(parsed) ?? defaultValue;
      return parsed as T;
    } catch {
      return defaultValue;
    }
  });

  // Skip the very first write so a read-only visit doesn't dirty storage.
  const hydrated = useRef(false);
  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // Quota or private-mode Safari — persistence is a nice-to-have.
    }
  }, [key, state]);

  return [state, setState];
}

/** Validator for a string union. */
export function oneOf<T extends string>(allowed: readonly T[]) {
  return (value: unknown): T | null =>
    typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** Validator for a string array (filters). */
export function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : null;
}
