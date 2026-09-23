/** A status change as the activity log records it. */
export interface StatusChange {
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

export interface StatusSpan {
  status: string;
  ms: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Compact duration: "45m", "16h", "2d 4h", "12d". */
export function formatDuration(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < HOUR) return `${Math.max(1, Math.floor(safe / MINUTE))}m`;
  if (safe < DAY) return `${Math.floor(safe / HOUR)}h`;
  const days = Math.floor(safe / DAY);
  const hours = Math.floor((safe % DAY) / HOUR);
  return days < 3 && hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

/**
 * Time spent in each status, in the order the issue went through them.
 *
 * Rebuilt from the `status_changed` rows of the activity log: each change
 * closes the span of its old status and opens one for the new status; the
 * last span runs until `until` (now, or the close date). A status visited
 * twice adds up. The log only holds status moves, so the time before the first
 * move is attributed to that move's old status from `createdAt`.
 */
export function timePerStatus(
  entries: StatusChange[],
  createdAt: string,
  currentStatus: string,
  until: Date = new Date(),
): StatusSpan[] {
  const moves = entries
    .filter((e) => e.action === 'status_changed' && e.field === 'status')
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const totals = new Map<string, number>();
  const add = (status: string, from: number, to: number) => {
    if (to <= from) {
      if (!totals.has(status)) totals.set(status, 0);
      return;
    }
    totals.set(status, (totals.get(status) ?? 0) + (to - from));
  };

  let status = moves[0]?.old_value ?? currentStatus;
  let since = new Date(createdAt).getTime();
  for (const move of moves) {
    const at = new Date(move.created_at).getTime();
    add(status, since, at);
    status = move.new_value ?? status;
    since = at;
  }
  add(status, since, until.getTime());

  return [...totals.entries()].map(([s, ms]) => ({ status: s, ms }));
}
