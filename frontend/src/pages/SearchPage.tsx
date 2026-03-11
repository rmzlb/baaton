import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import { Search, CircleDot, Filter, X } from 'lucide-react';

interface SearchResult {
  id: string;
  display_id: string;
  title: string;
  snippet: string | null;
  status: string;
  priority: string;
  project_id: string;
}

const STATUS_COLORS: Record<string, string> = {
  backlog: 'bg-gray-500/20 text-gray-400',
  todo: 'bg-blue-500/20 text-blue-400',
  in_progress: 'bg-yellow-500/20 text-yellow-400',
  in_review: 'bg-purple-500/20 text-purple-400',
  done: 'bg-green-500/20 text-green-400',
  cancelled: 'bg-red-500/20 text-red-400',
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-blue-400',
};

export default function SearchPage() {
  const apiClient = useApi();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [statusFilter, setStatusFilter] = useState<string | null>(searchParams.get('status'));
  const [showFilters, setShowFilters] = useState(false);

  // Fetch projects for name resolution
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
    staleTime: 60_000,
  });

  // Debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
      const params: Record<string, string> = {};
      if (query) params.q = query;
      if (statusFilter) params.status = statusFilter;
      setSearchParams(params, { replace: true });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, statusFilter]);

  // Search API
  const { data: results = [], isFetching } = useQuery({
    queryKey: ['search', debouncedQuery, statusFilter],
    queryFn: async () => {
      if (!debouncedQuery.trim()) return [];
      let url = `/search?q=${encodeURIComponent(debouncedQuery)}&limit=50`;
      if (statusFilter) url += `&status=${statusFilter}`;
      return apiClient.get<SearchResult[]>(url);
    },
    enabled: debouncedQuery.length >= 1,
  });

  const getProjectName = (projectId: string) => {
    const p = projects.find(p => p.id === projectId);
    return p?.name || 'Unknown';
  };

  const getProjectSlug = (projectId: string) => {
    const p = projects.find(p => p.id === projectId);
    return p?.slug || '';
  };

  // Group results by project
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    const name = getProjectName(r.project_id);
    if (!acc[name]) acc[name] = [];
    acc[name].push(r);
    return acc;
  }, {});

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Search header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-surface focus-within:border-accent transition-colors">
          <Search size={18} className={isFetching ? 'text-accent animate-pulse' : 'text-muted'} />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search all issues..."
            className="flex-1 bg-transparent text-sm text-primary placeholder:text-muted outline-none"
            autoFocus
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-muted hover:text-secondary">
              <X size={14} />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`p-3 rounded-xl border transition-colors ${showFilters ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-surface text-muted hover:text-secondary'}`}
        >
          <Filter size={16} />
        </button>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-[11px] text-muted font-medium">Status:</span>
          {['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(statusFilter === s ? null : s)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                statusFilter === s
                  ? STATUS_COLORS[s]
                  : 'text-muted bg-surface-hover hover:text-secondary'
              }`}
            >
              {s.replace('_', ' ')}
            </button>
          ))}
          {statusFilter && (
            <button onClick={() => setStatusFilter(null)} className="text-[11px] text-muted hover:text-secondary underline">
              Clear
            </button>
          )}
        </div>
      )}

      {/* Results count */}
      {debouncedQuery && (
        <div className="text-[11px] text-muted mb-4">
          {results.length} result{results.length !== 1 ? 's' : ''} for "{debouncedQuery}"
        </div>
      )}

      {/* Results grouped by project */}
      {Object.entries(grouped).map(([projectName, items]) => (
        <div key={projectName} className="mb-6">
          <h3 className="text-[11px] font-medium text-muted uppercase tracking-wider mb-2 px-1">
            {projectName}
          </h3>
          <div className="space-y-1">
            {items.map(item => (
              <Link
                key={item.id}
                to={`/projects/${getProjectSlug(item.project_id)}?issue=${item.display_id}`}
                className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-hover transition-colors group"
              >
                <CircleDot
                  size={14}
                  className={`mt-0.5 shrink-0 ${
                    item.status === 'done' ? 'text-green-400' :
                    item.status === 'in_progress' ? 'text-yellow-400' :
                    item.status === 'in_review' ? 'text-purple-400' :
                    'text-gray-400'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted font-mono">{item.display_id}</span>
                    <span className="text-sm text-primary group-hover:text-accent transition-colors truncate">
                      {item.title}
                    </span>
                  </div>
                  {item.snippet && (
                    <p
                      className="text-[11px] text-muted mt-0.5 line-clamp-2"
                      dangerouslySetInnerHTML={{ __html: item.snippet }}
                    />
                  )}
                </div>
                <span className={`text-[10px] font-medium capitalize shrink-0 mt-0.5 ${PRIORITY_COLORS[item.priority] || 'text-gray-400'}`}>
                  {item.priority}
                </span>
              </Link>
            ))}
          </div>
        </div>
      ))}

      {/* Empty states */}
      {!debouncedQuery && (
        <div className="py-16 text-center">
          <Search size={40} className="mx-auto text-muted/30 mb-4" />
          <p className="text-sm text-muted">Search across all your issues</p>
          <p className="text-[11px] text-muted/60 mt-1">Full-text search on titles, descriptions, and comments</p>
        </div>
      )}

      {debouncedQuery && results.length === 0 && !isFetching && (
        <div className="py-16 text-center">
          <p className="text-sm text-muted">No issues found for "{debouncedQuery}"</p>
          <p className="text-[11px] text-muted/60 mt-1">Try different keywords or remove filters</p>
        </div>
      )}
    </div>
  );
}
