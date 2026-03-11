import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Fuse from 'fuse.js';
import { useApi } from '@/hooks/useApi';
import {
  Search, ArrowRight, Kanban, LayoutDashboard, CheckSquare, AlertTriangle,
  FolderOpen, BarChart3, Webhook, Key, FileText, Hash,
  CornerDownLeft, ArrowUp, ArrowDown, CircleDot,
} from 'lucide-react';

interface PaletteItem {
  id: string;
  type: 'navigation' | 'issue' | 'project' | 'action';
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  action: () => void;
}

interface SearchResult {
  id: string;
  display_id: string;
  title: string;
  snippet?: string;
  status: string;
  priority: string;
  project_id: string;
}

const STATUS_COLORS: Record<string, string> = {
  backlog: 'text-gray-400',
  todo: 'text-blue-400',
  in_progress: 'text-yellow-400',
  in_review: 'text-purple-400',
  done: 'text-green-400',
  cancelled: 'text-red-400',
};

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const apiClient = useApi();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Debounce search query (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Fetch projects (cached)
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
    staleTime: 60_000,
  });

  // Live issue search via API
  const { data: searchResults = [], isFetching: isSearching } = useQuery({
    queryKey: ['command-search', debouncedQuery],
    queryFn: async () => {
      if (!debouncedQuery.trim() || debouncedQuery.length < 2) return [];
      const res = await apiClient.get<SearchResult[]>(`/search?q=${encodeURIComponent(debouncedQuery)}&limit=8`);
      return res;
    },
    enabled: debouncedQuery.length >= 2,
    staleTime: 10_000,
  });

  // Navigation items
  const navItems: PaletteItem[] = useMemo(() => [
    { id: 'nav-dashboard', type: 'navigation', title: 'Dashboard', subtitle: 'Overview & metrics', icon: <LayoutDashboard size={16} />, action: () => { navigate('/dashboard'); onClose(); } },
    { id: 'nav-my-tasks', type: 'navigation', title: 'My Tasks', subtitle: 'Issues assigned to you', icon: <CheckSquare size={16} />, action: () => { navigate('/my-tasks'); onClose(); } },
    { id: 'nav-all-issues', type: 'navigation', title: 'All Issues', subtitle: 'Browse all issues', icon: <Hash size={16} />, action: () => { navigate('/all-issues'); onClose(); } },
    { id: 'nav-triage', type: 'navigation', title: 'Triage', subtitle: 'Incoming issues', icon: <AlertTriangle size={16} />, action: () => { navigate('/triage'); onClose(); } },
    { id: 'nav-projects', type: 'navigation', title: 'Projects', subtitle: 'All projects', icon: <FolderOpen size={16} />, action: () => { navigate('/projects'); onClose(); } },
    { id: 'nav-analytics', type: 'navigation', title: 'Analytics', subtitle: 'Metrics & insights', icon: <BarChart3 size={16} />, action: () => { navigate('/analytics'); onClose(); } },
    { id: 'nav-webhooks', type: 'navigation', title: 'Webhooks', subtitle: 'Event subscriptions', icon: <Webhook size={16} />, action: () => { navigate('/webhooks'); onClose(); } },
    { id: 'nav-api-keys', type: 'navigation', title: 'API Keys', subtitle: 'Manage API keys', icon: <Key size={16} />, action: () => { navigate('/api-keys'); onClose(); } },
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

  // Issue items from search API
  const issueItems: PaletteItem[] = useMemo(() =>
    searchResults.map(r => {
      // Find project slug for navigation
      const project = projects.find(p => p.id === r.project_id);
      return {
        id: `issue-${r.id}`,
        type: 'issue' as const,
        title: `${r.display_id}: ${r.title}`,
        subtitle: r.snippet ? r.snippet.replace(/<\/?b>/g, '').slice(0, 80) : r.status,
        icon: <CircleDot size={16} className={STATUS_COLORS[r.status] || 'text-gray-400'} />,
        action: () => {
          if (project) {
            navigate(`/projects/${project.slug}?issue=${r.display_id}`);
          }
          onClose();
        },
      };
    }),
    [searchResults, projects, navigate, onClose]
  );

  // Static items for fuse search
  const staticItems = useMemo(() => [...navItems, ...projectItems], [navItems, projectItems]);

  const fuse = useMemo(() => new Fuse(staticItems, {
    keys: ['title', 'subtitle'],
    threshold: 0.4,
    includeScore: true,
  }), [staticItems]);

  // Combined results: issues first (if searching), then fuse results
  const results = useMemo(() => {
    if (!query.trim()) {
      return staticItems.slice(0, 12);
    }
    const fuseResults = fuse.search(query).slice(0, 6).map(r => r.item);
    // Issues from API go first, then local fuse results
    const combined = [...issueItems, ...fuseResults];
    // Dedupe by id
    const seen = new Set<string>();
    return combined.filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }).slice(0, 12);
  }, [query, fuse, staticItems, issueItems]);

  // Reset active on results change
  useEffect(() => { setActiveIndex(0); }, [results]);
  // Focus on mount
  useEffect(() => { inputRef.current?.focus(); }, []);
  // Scroll active into view
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
          <Search size={18} className={`shrink-0 ${isSearching ? 'text-accent animate-pulse' : 'text-secondary'}`} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search issues, projects, or navigate..."
            className="flex-1 bg-transparent text-sm text-primary placeholder:text-muted outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border text-[10px] text-muted font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[360px] overflow-y-auto py-1">
          {results.length === 0 && !isSearching ? (
            <div className="px-4 py-8 text-center text-sm text-muted">
              {query.length > 0 ? 'No results found' : 'Start typing to search...'}
            </div>
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
          {isSearching && (
            <div className="px-4 py-2 text-center text-[11px] text-muted animate-pulse">Searching issues...</div>
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
