import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Fuse from 'fuse.js';
import { useApi } from '@/hooks/useApi';

import {
  Search, ArrowRight, Kanban, LayoutDashboard, CheckSquare, AlertTriangle,
  FolderOpen, BarChart3, Webhook, Key, FileText, Hash,
  CornerDownLeft, ArrowUp, ArrowDown,
} from 'lucide-react';

interface PaletteItem {
  id: string;
  type: 'navigation' | 'issue' | 'project' | 'action';
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  action: () => void;
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const apiClient = useApi();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  // Fetch data for search
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
    staleTime: 60_000,
  });

  // Navigation items
  const navItems: PaletteItem[] = useMemo(() => [
    { id: 'nav-dashboard', type: 'navigation', title: 'Dashboard', subtitle: 'Overview', icon: <LayoutDashboard size={16} />, action: () => { navigate('/dashboard'); onClose(); } },
    { id: 'nav-my-tasks', type: 'navigation', title: 'My Tasks', subtitle: 'Issues assigned to you', icon: <CheckSquare size={16} />, action: () => { navigate('/my-tasks'); onClose(); } },
    { id: 'nav-all-issues', type: 'navigation', title: 'All Issues', subtitle: 'Browse all issues', icon: <Hash size={16} />, action: () => { navigate('/all-issues'); onClose(); } },
    { id: 'nav-triage', type: 'navigation', title: 'Triage', subtitle: 'Incoming issues', icon: <AlertTriangle size={16} />, action: () => { navigate('/triage'); onClose(); } },
    { id: 'nav-projects', type: 'navigation', title: 'Projects', subtitle: 'All projects', icon: <FolderOpen size={16} />, action: () => { navigate('/projects'); onClose(); } },
    { id: 'nav-analytics', type: 'navigation', title: 'Analytics', subtitle: 'Metrics & insights', icon: <BarChart3 size={16} />, action: () => { navigate('/analytics'); onClose(); } },
    { id: 'nav-webhooks', type: 'navigation', title: 'Webhooks', subtitle: 'Event subscriptions', icon: <Webhook size={16} />, action: () => { navigate('/webhooks'); onClose(); } },
    { id: 'nav-api-keys', type: 'navigation', title: 'API Keys', subtitle: 'Manage keys', icon: <Key size={16} />, action: () => { navigate('/api-keys'); onClose(); } },
    { id: 'nav-docs', type: 'navigation', title: 'Documentation', subtitle: 'API reference', icon: <FileText size={16} />, action: () => { navigate('/docs'); onClose(); } },
  ], [navigate, onClose]);

  // Project items
  const projectItems: PaletteItem[] = useMemo(() =>
    projects.map(p => ({
      id: `project-${p.id}`,
      type: 'project' as const,
      title: p.name,
      subtitle: `${p.prefix} · ${p.slug}`,
      icon: <Kanban size={16} />,
      action: () => { navigate(`/projects/${p.slug}`); onClose(); },
    })),
    [projects, navigate, onClose]
  );

  // All items
  const allItems = useMemo(() => [...navItems, ...projectItems], [navItems, projectItems]);

  // Fuse search
  const fuse = useMemo(() => new Fuse(allItems, {
    keys: ['title', 'subtitle'],
    threshold: 0.4,
    includeScore: true,
  }), [allItems]);

  // Filtered results
  const results = useMemo(() => {
    if (!query.trim()) {
      return allItems.slice(0, 12);
    }
    return fuse.search(query).slice(0, 12).map(r => r.item);
  }, [query, fuse, allItems]);

  // Reset active index on results change
  useEffect(() => { setActiveIndex(0); }, [results]);

  // Focus input on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex(i => Math.min(i + 1, results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        results[activeIndex]?.action();
        break;
      case 'Escape':
        onClose();
        break;
    }
  }, [results, activeIndex, onClose]);

  const typeLabels: Record<string, string> = {
    navigation: 'Go to',
    project: 'Project',
    issue: 'Issue',
    action: 'Action',
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-black/50 dark:bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-border bg-surface shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search size={18} className="text-secondary shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search or jump to..."
            className="flex-1 bg-transparent text-sm text-primary placeholder:text-muted outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border text-[10px] text-muted font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[320px] overflow-y-auto py-1">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted">No results found</div>
          ) : (
            results.map((item, i) => (
              <button
                key={item.id}
                onClick={item.action}
                onMouseEnter={() => setActiveIndex(i)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  i === activeIndex
                    ? 'bg-accent/10 text-primary'
                    : 'text-secondary hover:bg-surface-hover'
                }`}
              >
                <span className={i === activeIndex ? 'text-accent' : 'text-muted'}>{item.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{item.title}</div>
                  {item.subtitle && (
                    <div className="text-[11px] text-muted truncate">{item.subtitle}</div>
                  )}
                </div>
                <span className="text-[10px] text-muted font-mono shrink-0">{typeLabels[item.type]}</span>
                {i === activeIndex && <ArrowRight size={14} className="text-accent shrink-0" />}
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-border text-[10px] text-muted">
          <span className="inline-flex items-center gap-1"><CornerDownLeft size={10} /> Select</span>
          <span className="inline-flex items-center gap-1"><ArrowUp size={10} /><ArrowDown size={10} /> Navigate</span>
          <span className="inline-flex items-center gap-1">ESC Close</span>
        </div>
      </div>
    </div>
  );
}
