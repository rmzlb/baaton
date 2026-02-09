export function PageLoader() {
  return (
    <div className="flex h-full min-h-[50vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <span className="text-xs text-muted">Loading…</span>
      </div>
    </div>
  );
}

export default PageLoader;
