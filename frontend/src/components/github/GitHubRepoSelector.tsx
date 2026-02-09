import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Lock, Globe, Loader2, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import type { GitHubRepository } from '@/lib/types';

interface GitHubRepoSelectorProps {
  selectedRepoId: number | null;
  onSelect: (repo: GitHubRepository) => void;
  excludeRepoIds?: number[];
}

export function GitHubRepoSelector({ selectedRepoId, onSelect, excludeRepoIds = [] }: GitHubRepoSelectorProps) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  const { data: repos = [], isLoading } = useQuery({
    queryKey: ['github-repos'],
    queryFn: () => apiClient.github.listRepos(),
  });

  const filteredRepos = repos
    .filter((r) => !excludeRepoIds.includes(r.github_repo_id))
    .filter((r) =>
      r.full_name.toLowerCase().includes(search.toLowerCase()),
    );

  const selectedRepo = repos.find((r) => r.github_repo_id === selectedRepoId);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary hover:border-accent transition-colors"
      >
        {selectedRepo ? (
          <>
            {selectedRepo.is_private ? <Lock size={14} className="text-muted" /> : <Globe size={14} className="text-muted" />}
            <span className="truncate flex-1 text-left">{selectedRepo.full_name}</span>
          </>
        ) : (
          <span className="text-muted flex-1 text-left">{t('github.selectRepo')}</span>
        )}
        <ChevronDown size={14} className="text-muted shrink-0" />
      </button>

      {open && (
        <div className="absolute top-full left-0 z-20 mt-1 w-full rounded-lg border border-border bg-surface shadow-xl max-h-64 overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b border-border">
            <div className="flex items-center gap-2 rounded-md bg-bg border border-border px-2 py-1.5">
              <Search size={14} className="text-muted shrink-0" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('github.searchRepos')}
                className="bg-transparent text-sm text-primary placeholder-muted outline-none flex-1"
                autoFocus
              />
            </div>
          </div>

          {/* Repo list */}
          <div className="overflow-y-auto max-h-48">
            {isLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 size={16} className="animate-spin text-muted" />
              </div>
            ) : filteredRepos.length === 0 ? (
              <p className="text-xs text-muted text-center py-4">
                {t('github.noReposFound')}
              </p>
            ) : (
              filteredRepos.map((repo) => (
                <button
                  key={repo.github_repo_id}
                  type="button"
                  onClick={() => {
                    onSelect(repo);
                    setOpen(false);
                    setSearch('');
                  }}
                  className={cn(
                    'flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-surface-hover transition-colors',
                    selectedRepoId === repo.github_repo_id
                      ? 'text-accent bg-accent/5'
                      : 'text-primary',
                  )}
                >
                  {repo.is_private ? (
                    <Lock size={12} className="text-muted shrink-0" />
                  ) : (
                    <Globe size={12} className="text-muted shrink-0" />
                  )}
                  <span className="truncate text-left flex-1">{repo.full_name}</span>
                  <span className="text-[10px] text-muted shrink-0">{repo.default_branch}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
