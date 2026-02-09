import { create } from 'zustand';

function getInitialTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem('baaton-theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return 'dark';
}

function getInitialDensity(): BoardDensity {
  if (typeof window === 'undefined') return 'default';
  const stored = localStorage.getItem('baaton-density');
  if (stored === 'compact' || stored === 'default' || stored === 'spacious') return stored;
  return 'default';
}

export type BoardDensity = 'compact' | 'default' | 'spacious';

interface UIState {
  sidebarCollapsed: boolean;
  sidebarMobileOpen: boolean;
  theme: 'dark' | 'light';
  density: BoardDensity;
  commandBarOpen: boolean;

  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  openMobileSidebar: () => void;
  closeMobileSidebar: () => void;
  setTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;
  setDensity: (density: BoardDensity) => void;
  cycleDensity: () => void;
  openCommandBar: () => void;
  closeCommandBar: () => void;
}

const DENSITY_CYCLE: BoardDensity[] = ['compact', 'default', 'spacious'];

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  sidebarMobileOpen: false,
  theme: getInitialTheme(),
  density: getInitialDensity(),
  commandBarOpen: false,

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  openMobileSidebar: () => set({ sidebarMobileOpen: true }),
  closeMobileSidebar: () => set({ sidebarMobileOpen: false }),
  setTheme: (theme) => {
    localStorage.setItem('baaton-theme', theme);
    set({ theme });
  },
  toggleTheme: () =>
    set((s) => {
      const next = s.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('baaton-theme', next);
      return { theme: next };
    }),
  setDensity: (density) => {
    localStorage.setItem('baaton-density', density);
    set({ density });
  },
  cycleDensity: () =>
    set((s) => {
      const idx = DENSITY_CYCLE.indexOf(s.density);
      const next = DENSITY_CYCLE[(idx + 1) % DENSITY_CYCLE.length];
      localStorage.setItem('baaton-density', next);
      return { density: next };
    }),
  openCommandBar: () => set({ commandBarOpen: true }),
  closeCommandBar: () => set({ commandBarOpen: false }),
}));
